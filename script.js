(function(){
  const MULTISWAP_ADDRESS = "0xC71b9D161780AbA17D60b86D5d2Fb07F98DD5279";
  const LENDING_ADDRESS = "0xd9145CCE52D386f254917e481eB44e9943F39138";
  const ARC_CHAIN_ID = 5042002;
  const ARC_CHAIN_HEX = "0x" + ARC_CHAIN_ID.toString(16);
  const MAX_UINT = ethers.MaxUint256;

  const TOKENS = {
    USDC:   { address: "0x3600000000000000000000000000000000000000", decimals: 6, color: "var(--usdc)" },
    EURC:   { address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", decimals: 6, color: "var(--eurc)" },
    CIRBTC: { address: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8, color: "var(--btc)" }
  };
  const TOKEN_LIST = Object.keys(TOKENS);

  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)"
  ];
  const SWAP_ABI = [
    "function getReserves(address,address) view returns (uint256,uint256)",
    "function getAmountOut(uint256,uint256,uint256) pure returns (uint256)",
    "function swap(address,address,uint256) returns (uint256)",
    "function addLiquidity(address,address,uint256,uint256)"
  ];
  const LENDING_ABI = [
    "function tokenPriceUSD(address) view returns (uint256)",
    "function deposit(address,uint256)",
    "function withdraw(address,uint256)",
    "function claimInterest(address)",
    "function depositCollateral(address,uint256)",
    "function withdrawCollateral(address,uint256)",
    "function borrow(address,uint256)",
    "function repay(address,uint256)",
    "function getDepositBalance(address,address) view returns (uint256,uint256)",
    "function getBorrowBalance(address,address) view returns (uint256,uint256)",
    "function collateral(address,address) view returns (uint256)",
    "function getCollateralValueUSD(address) view returns (uint256)",
    "function getBorrowValueUSD(address) view returns (uint256)",
    "function getMaxBorrowableUSD(address) view returns (uint256)"
  ];

  let provider, signer, userAddress;
  let direction = { from: "USDC", to: "EURC" };
  let balances = {};

  // Reads go through a direct RPC connection instead of the wallet extension. Wallet
  // extensions (MetaMask, Rabby) can cache eth_call results internally, which was causing
  // balances/deposits to show stale (zero) data right after a confirmed transaction.
  //
  // FIX: switched from Arc's default public RPC (rpc.testnet.arc.network) to dRPC's free
  // Arc testnet endpoint. The default endpoint was returning "429 Too Many Requests" for
  // read calls (getDepositBalance/getBorrowBalance etc.), which is what caused deposits to
  // show as 0 even though the on-chain deposit itself had succeeded. dRPC's endpoint pools
  // requests across a different set of nodes, so it isn't sharing the same rate-limit bucket.
  const readProvider = new ethers.JsonRpcProvider("https://arc-testnet.drpc.org");

  const el = id => document.getElementById(id);
  const walletBtn = el("walletBtn");

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      el("panel-" + btn.dataset.tab).classList.add("active");
      if (signer) refreshForTab(btn.dataset.tab);
    });
  });

  // Only fetch what the currently-open tab actually needs, instead of everything every time.
  async function refreshForTab(tab){
    if (!signer) return;
    await refreshBalancesOnly();
    if (tab === "swap") { renderSwapBalances(); }
    else if (tab === "liquidity") { renderLiquidityPanel(); }
    else if (tab === "lend") { renderLendRows(); }
    else if (tab === "borrow") { renderBorrowRows(); }
  }

  function showErr(id, msg){ const e = el(id); e.textContent = msg; e.classList.add("show"); }
  function clearErr(id){ const e = el(id); e.textContent = ""; e.classList.remove("show"); }
  function showSuccess(elId, msgId, msg){
    el(msgId).textContent = msg;
    el(elId).classList.add("show");
    setTimeout(() => el(elId).classList.remove("show"), 3500);
  }

  // ---------- Standalone: Add Arc Testnet (Faucet tab, works even before full connect) ----------
  el("addNetworkBtn").addEventListener("click", async () => {
    clearErr("faucetErr");
    if (typeof window.ethereum === "undefined") { showErr("faucetErr", "No wallet found. Install MetaMask or Rabby first."); return; }
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
      showSuccess("faucetSuccess", "faucetSuccessMsg", "Arc Testnet is set as your active network.");
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: ARC_CHAIN_HEX,
              chainName: "Arc Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: ["https://rpc.testnet.arc.network"],
              blockExplorerUrls: ["https://testnet.arcscan.app"]
            }]
          });
          showSuccess("faucetSuccess", "faucetSuccessMsg", "Arc Testnet added to your wallet!");
        } catch (addErr) {
          console.error(addErr);
          showErr("faucetErr", "Could not add the network. Please try again.");
        }
      } else if (switchErr.code === 4001) {
        showErr("faucetErr", "Request rejected.");
      } else {
        console.error(switchErr);
        showErr("faucetErr", "Could not switch network. Please try again.");
      }
    }
  });

  // ---------- Network selector (cosmetic — Arc Mainnet is a "Soon" placeholder) ----------
  const networkBtn = el("networkBtn");
  const networkMenu = el("networkMenu");
  const networkWrap = el("networkWrap");
  if (networkBtn) {
    networkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = networkMenu.classList.toggle("open");
      networkWrap.classList.toggle("open", isOpen);
    });
    document.addEventListener("click", (e) => {
      if (networkWrap && !networkWrap.contains(e.target)) {
        networkMenu.classList.remove("open");
        networkWrap.classList.remove("open");
      }
    });
  }

  const walletMenu = el("walletMenu");
  const walletWrap = document.querySelector(".wallet-wrap");

  async function connectWallet(){
    if (typeof window.ethereum === "undefined") { showErr("swapErr", "No wallet found. Install MetaMask to continue."); return; }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      await ensureArcNetwork();
      signer = await provider.getSigner();
      userAddress = await signer.getAddress();
      renderConnectedWallet();
      el("cardDot").classList.add("on");
      el("statusTag").innerHTML = '<span class="dot on"></span> Connected';
      await refreshAll();
      window.ethereum.on && window.ethereum.on("accountsChanged", () => window.location.reload());
      window.ethereum.on && window.ethereum.on("chainChanged", () => window.location.reload());
    } catch (err) {
      console.error(err);
      showErr("swapErr", err && err.code === 4001 ? "Connection request rejected." : "Could not connect wallet.");
    }
  }

  function renderConnectedWallet(){
    walletBtn.innerHTML =
      '<span class="wallet-avatar"></span>' +
      '<span>' + userAddress.slice(0,6) + '…' + userAddress.slice(-4) + '</span>' +
      '<svg class="wallet-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 3L5 7L9 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    walletBtn.classList.add("connected");
    el("walletMenuAddress").textContent = userAddress;
  }

  function closeWalletMenu(){
    walletMenu.classList.remove("open");
    walletWrap.classList.remove("open");
  }

  function disconnectWallet(){
    signer = null; userAddress = null; balances = {};
    walletBtn.classList.remove("connected");
    walletBtn.innerHTML = "Connect Wallet";
    el("cardDot").classList.remove("on");
    el("statusTag").innerHTML = '<span class="dot" id="cardDot"></span> Not connected';
    closeWalletMenu();
    renderSwapBalances();
  }

  walletBtn.addEventListener("click", (e) => {
    if (!signer) { connectWallet(); return; }
    e.stopPropagation();
    const isOpen = walletMenu.classList.toggle("open");
    walletWrap.classList.toggle("open", isOpen);
  });

  document.addEventListener("click", (e) => {
    if (walletWrap && !walletWrap.contains(e.target)) closeWalletMenu();
  });

  el("copyAddressBtn").addEventListener("click", () => {
    if (!userAddress) return;
    navigator.clipboard.writeText(userAddress).catch(() => {});
    closeWalletMenu();
  });
  el("viewExplorerBtn").addEventListener("click", () => {
    if (!userAddress) return;
    window.open("https://testnet.arcscan.app/address/" + userAddress, "_blank", "noopener");
    closeWalletMenu();
  });
  el("disconnectBtn").addEventListener("click", disconnectWallet);

  async function ensureArcNetwork(){
    const net = await provider.getNetwork();
    if (Number(net.chainId) === ARC_CHAIN_ID) return;
    try {
      await provider.send("wallet_switchEthereumChain", [{chainId: ARC_CHAIN_HEX}]);
    } catch (switchErr) {
      if (switchErr.code === 4902 || (switchErr.error && switchErr.error.code === 4902)) {
        await provider.send("wallet_addEthereumChain", [{
          chainId: ARC_CHAIN_HEX, chainName: "Arc Testnet",
          nativeCurrency: {name:"USDC", symbol:"USDC", decimals:18},
          rpcUrls: ["https://rpc.testnet.arc.network"],
          blockExplorerUrls: ["https://testnet.arcscan.app"]
        }]);
      } else { throw switchErr; }
    }
  }
  function tokenContract(sym, runner){ return new ethers.Contract(TOKENS[sym].address, ERC20_ABI, runner); }
  function fmt(sym, raw){ return Number(ethers.formatUnits(raw, TOKENS[sym].decimals)); }
  function parse(sym, val){ return ethers.parseUnits(val, TOKENS[sym].decimals); }

  // FIX: the console showed real "429 Too Many Requests" errors from Arc's public RPC —
  // the app was hammering it with retries too fast, which just triggers more 429s. A 429
  // means "back off", not "try again immediately", so we now detect it specifically and
  // wait much longer (2s, 4s, 8s...) before the next attempt instead of a fixed short delay.
  function isRateLimited(err){
    const msg = (err && (err.message || err.shortMessage || "")) + "";
    return msg.includes("429")
      || (err && err.info && err.info.responseStatus && String(err.info.responseStatus).includes("429"))
      || (err && err.error && err.error.code === -32005); // common "rate limit" JSON-RPC code
  }

  async function withRetry(fn, attempts = 5, baseDelayMs = 600){
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try { return await fn(); }
      catch (err) {
        lastErr = err;
        if (i < attempts - 1) {
          const wait = isRateLimited(err)
            ? 2000 * Math.pow(2, i)      // 2s, 4s, 8s, 16s... on 429 specifically
            : baseDelayMs * (i + 1);     // normal short backoff for other errors
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }
    throw lastErr;
  }

  // FIX: run a list of async read calls one-after-another (staggered) instead of all at
  // once with Promise.all. Firing 3+ getDepositBalance/getBorrowBalance calls at the exact
  // same millisecond right after a confirmed tx was overloading/rate-limiting Arc's public
  // RPC endpoint (429s), which caused several of them to fail and silently render as 0.
  // Gap raised 120ms -> 350ms to further reduce how many requests/sec we send.
  async function sequential(items, fn){
    const out = [];
    for (const item of items) {
      out.push(await fn(item));
      await new Promise(r => setTimeout(r, 350));
    }
    return out;
  }


  // ethers v6's tx.wait() resolves even for a reverted transaction — it does NOT throw
  // automatically. Always check receipt.status ourselves before showing a success message.
  async function requireSuccess(tx){
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("Transaction reverted on-chain.");
    }
    return receipt;
  }

  async function ensureApproval(sym, spender, neededAmount){
    const c = tokenContract(sym, signer);
    const allowance = await withRetry(() => c.allowance(userAddress, spender));
    if (allowance < neededAmount) {
      const tx = await c.approve(spender, MAX_UINT);
      await requireSuccess(tx);
    }
  }

  async function refreshBalancesOnly(){
    if (!signer) return;
    const results = await sequential(TOKEN_LIST, async sym => {
      try { return [sym, fmt(sym, await withRetry(() => tokenContract(sym, readProvider).balanceOf(userAddress)))]; }
      catch(e){ console.error("Balance fetch failed for", sym, e); return [sym, null]; }
    });
    results.forEach(([sym, val]) => { if (val !== null) balances[sym] = val; });
  }

  async function refreshAll(){
    if (!signer) return;
    await refreshBalancesOnly();
    renderSwapBalances();
    renderLiquidityPanel();
    renderLendRows();
    renderBorrowRows();
  }

  // After a transaction confirms, Arc Testnet's RPC nodes can take a moment to sync with
  // each other. Give it a head start before reading balances, otherwise a read can land on
  // a node that hasn't seen the new block yet and shows stale data.
  // FIX: raised 1500ms -> 2500ms, and this now pairs with the higher retry count above.
  async function refreshAllAfterTx(){
    await new Promise(r => setTimeout(r, 2500));
    await refreshAll();
  }

  function populateTokenSelects(){
    ["fromTokenSelect","toTokenSelect"].forEach(id => {
      const sel = el(id);
      sel.innerHTML = TOKEN_LIST.map(s => `<option value="${s}">${s}</option>`).join("");
    });
    el("fromTokenSelect").value = direction.from;
    el("toTokenSelect").value = direction.to;
  }
  populateTokenSelects();

  el("fromTokenSelect").addEventListener("change", e => {
    direction.from = e.target.value;
    if (direction.from === direction.to) {
      direction.to = TOKEN_LIST.find(t => t !== direction.from);
      el("toTokenSelect").value = direction.to;
    }
    onAmountChange();
    renderSwapBalances();
  });
  el("toTokenSelect").addEventListener("change", e => {
    direction.to = e.target.value;
    if (direction.to === direction.from) {
      direction.from = TOKEN_LIST.find(t => t !== direction.to);
      el("fromTokenSelect").value = direction.from;
    }
    onAmountChange();
    renderSwapBalances();
  });
  el("flipBtn").addEventListener("click", () => {
    [direction.from, direction.to] = [direction.to, direction.from];
    populateTokenSelects();
    el("amountIn").value = ""; el("amountOut").value = ""; el("rateLine").textContent = "";
    renderSwapBalances();
    updateSwapAction();
  });

  function renderSwapBalances(){
    el("fromBalance").textContent = (balances[direction.from] !== undefined ? balances[direction.from].toFixed(4) : "—") + " " + direction.from;
    el("toBalance").textContent = (balances[direction.to] !== undefined ? balances[direction.to].toFixed(4) : "—") + " " + direction.to;
  }
  // 25% / 50% / MAX quick-fill buttons on the "You pay" field.
  document.querySelectorAll("#panel-swap .pct-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const bal = balances[direction.from];
      if (!bal) return;
      const pct = Number(btn.dataset.pct) / 100;
      const amt = bal * pct;
      // Trim to a sane number of decimals so the input doesn't show float noise.
      el("amountIn").value = pct === 1 ? String(amt) : amt.toFixed(6);
      onAmountChange();
    });
  });

  let estimateTimer;
  el("amountIn").addEventListener("input", () => { clearTimeout(estimateTimer); estimateTimer = setTimeout(onAmountChange, 250); });

  async function onAmountChange(){
    clearErr("swapErr");
    const val = el("amountIn").value;
    if (!val || Number(val) <= 0 || !provider) { el("amountOut").value=""; el("rateLine").textContent=""; updateSwapAction(); return; }
    try {
      const swap = new ethers.Contract(MULTISWAP_ADDRESS, SWAP_ABI, readProvider);
      const [reserveIn, reserveOut] = await withRetry(() => swap.getReserves(TOKENS[direction.from].address, TOKENS[direction.to].address));
      if (reserveIn === 0n || reserveOut === 0n) { el("amountOut").value=""; el("rateLine").textContent="Pool has no liquidity yet."; updateSwapAction(); return; }
      const amtIn = parse(direction.from, val);
      const out = await withRetry(() => swap.getAmountOut(amtIn, reserveIn, reserveOut));
      const outFormatted = fmt(direction.to, out);
      el("amountOut").value = outFormatted.toFixed(6);
      el("rateLine").textContent = "1 " + direction.from + " ≈ " + (outFormatted/Number(val)).toFixed(6) + " " + direction.to;
    } catch (err) { console.error(err); el("amountOut").value=""; }
    updateSwapAction();
  }

  async function updateSwapAction(){
    const btn = el("swapActionBtn");
    if (!signer) { btn.textContent = "Connect Wallet"; btn.disabled = false; btn.onclick = connectWallet; btn.classList.remove("warn"); return; }
    const val = el("amountIn").value;
    if (!val || Number(val) <= 0) { btn.textContent = "Enter an Amount"; btn.disabled = true; btn.classList.remove("warn"); return; }
    try {
      const c = tokenContract(direction.from, readProvider);
      const allowance = await c.allowance(userAddress, MULTISWAP_ADDRESS);
      const amtIn = parse(direction.from, val);
      if (allowance < amtIn) {
        btn.textContent = "Approve " + direction.from; btn.disabled = false; btn.classList.add("warn");
        btn.onclick = () => doApproveThenSwap();
      } else {
        btn.textContent = "Confirm Swap"; btn.disabled = false; btn.classList.remove("warn");
        btn.onclick = doSwap;
      }
    } catch(e){ console.error(e); }
  }

  async function doApproveThenSwap(){
    clearErr("swapErr");
    const btn = el("swapActionBtn"); btn.disabled = true; btn.textContent = "Approving…";
    try {
      const c = tokenContract(direction.from, signer);
      const tx = await c.approve(MULTISWAP_ADDRESS, MAX_UINT);
      await requireSuccess(tx);
      await updateSwapAction();
    } catch (err) { console.error(err); showErr("swapErr", err.shortMessage || "Approval failed."); updateSwapAction(); }
  }

  async function doSwap(){
    clearErr("swapErr");
    const btn = el("swapActionBtn"); btn.disabled = true; btn.textContent = "Confirming…";
    try {
      const swap = new ethers.Contract(MULTISWAP_ADDRESS, SWAP_ABI, signer);
      const amtIn = parse(direction.from, el("amountIn").value);
      const tx = await swap.swap(TOKENS[direction.from].address, TOKENS[direction.to].address, amtIn);
      await requireSuccess(tx);
      showSuccess("swapSuccess","swapSuccessMsg","Swap complete — " + direction.from + " → " + direction.to);
      el("amountIn").value=""; el("amountOut").value=""; el("rateLine").textContent="";
      await refreshAllAfterTx();
    } catch (err) { console.error(err); showErr("swapErr", err.shortMessage || "Swap failed."); updateSwapAction(); }
  }

  function poolPair(){
    const val = el("poolSelect").value;
    return val === "USDC-EURC" ? ["USDC","EURC"] : val === "USDC-CIRBTC" ? ["USDC","CIRBTC"] : ["EURC","CIRBTC"];
  }
  el("poolSelect").addEventListener("change", renderLiquidityPanel);

  async function renderLiquidityPanel(){
    const [a,b] = poolPair();
    el("liqTokenALabel").textContent = a;
    el("liqTokenBLabel").textContent = b;
    el("liqBalanceA").textContent = (balances[a]!==undefined ? balances[a].toFixed(4) : "—") + " " + a;
    el("liqBalanceB").textContent = (balances[b]!==undefined ? balances[b].toFixed(4) : "—") + " " + b;
    if (provider) {
      try {
        const swap = new ethers.Contract(MULTISWAP_ADDRESS, SWAP_ABI, readProvider);
        const [rA, rB] = await withRetry(() => swap.getReserves(TOKENS[a].address, TOKENS[b].address));
        el("liqReservesLine").textContent = `Pool reserves — ${fmt(a,rA).toFixed(4)} ${a} ⇌ ${fmt(b,rB).toFixed(6)} ${b}`;
      } catch(e){ el("liqReservesLine").textContent = "Pool reserves — unavailable"; }
    }
    updateLiqAction();
  }

  [el("liqAmountA"), el("liqAmountB")].forEach(inp => inp.addEventListener("input", updateLiqAction));

  async function updateLiqAction(){
    const btn = el("liqActionBtn");
    if (!signer) { btn.textContent = "Connect Wallet"; btn.disabled = false; btn.onclick = connectWallet; return; }
    const va = el("liqAmountA").value, vb = el("liqAmountB").value;
    if (!va || !vb || Number(va) <= 0 || Number(vb) <= 0) { btn.textContent = "Enter Amounts"; btn.disabled = true; return; }
    btn.textContent = "Add Liquidity"; btn.disabled = false;
    btn.onclick = doAddLiquidity;
  }

  async function doAddLiquidity(){
    clearErr("liqErr");
    const [a,b] = poolPair();
    const btn = el("liqActionBtn"); btn.disabled = true; btn.textContent = "Approving tokens…";
    try {
      const amtA = parse(a, el("liqAmountA").value);
      const amtB = parse(b, el("liqAmountB").value);
      await ensureApproval(a, MULTISWAP_ADDRESS, amtA);
      await ensureApproval(b, MULTISWAP_ADDRESS, amtB);
      btn.textContent = "Adding liquidity…";
      const swap = new ethers.Contract(MULTISWAP_ADDRESS, SWAP_ABI, signer);
      const tx = await swap.addLiquidity(TOKENS[a].address, TOKENS[b].address, amtA, amtB);
      await requireSuccess(tx);
      showSuccess("liqSuccess","liqSuccessMsg","Liquidity added to " + a + "/" + b);
      el("liqAmountA").value=""; el("liqAmountB").value="";
      await refreshAllAfterTx();
    } catch (err) { console.error(err); showErr("liqErr", err.shortMessage || "Adding liquidity failed."); }
    updateLiqAction();
  }

  // FIX: previously any failed read (getDepositBalance) silently became [0n, 0n], making a
  // successful deposit LOOK like it never happened. Now a failed read is tracked separately
  // (failed = true) so the row can say "Couldn't load — tap to retry" instead of lying with 0.
  async function renderLendRows(){
    const container = el("lendRows");
    if (!signer) { container.innerHTML = '<div class="err-line show" style="color:var(--text-faint)">Connect your wallet to view lending.</div>'; return; }
    const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, readProvider);
    const results = await sequential(TOKEN_LIST, async sym => {
      try { return [sym, await withRetry(() => lending.getDepositBalance(userAddress, TOKENS[sym].address)), false]; }
      catch(e){ console.error("getDepositBalance failed for", sym, e); return [sym, [0n, 0n], true]; }
    });
    const dataBySym = {};
    const failedBySym = {};
    results.forEach(([sym, data, failed]) => { dataBySym[sym] = data; failedBySym[sym] = failed; });
    let html = "";
    for (const sym of TOKEN_LIST) {
      const [principal, interest] = dataBySym[sym];
      const failed = failedBySym[sym];
      const statsHtml = failed
        ? `<span style="color:var(--warn,#e0a030);">Couldn't load balance — <a href="#" onclick="window.__retryLend('${sym}');return false;">tap to retry</a></span>`
        : `Deposited: ${fmt(sym,principal).toFixed(4)}<br>Interest: ${fmt(sym,interest).toFixed(6)}`;
      html += `
        <div class="token-row">
          <div class="token-row-head">
            <div class="token-chip"><span class="token-dot" style="background:${TOKENS[sym].color}">${sym[0]}</span><span class="token-name">${sym}</span></div>
            <div class="token-stats">${statsHtml}</div>
          </div>
          <div class="token-input-row">
            <input type="text" inputmode="decimal" placeholder="Amount" id="lendAmt-${sym}">
            ${pctGroupHtml("lendAmt-" + sym, sym, "wallet")}
          </div>
          <div class="btn-row">
            <button class="btn" style="flex:1;" onclick="window.__lendDeposit('${sym}')">Deposit</button>
            <button class="btn ghost" style="flex:1;" onclick="window.__lendWithdraw('${sym}')">Withdraw</button>
            <button class="btn ghost" style="flex:1;" onclick="window.__lendClaim('${sym}')">Claim</button>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  }

  window.__retryLend = function(){ renderLendRows(); };
  window.__retryBorrow = function(){ renderBorrowRows(); };

  // Small HTML snippet for a 25% / 50% / MAX button group next to an amount input.
  // mode "wallet"    -> fills a percentage of the connected wallet's token balance
  // mode "borrowmax" -> fills a percentage of how much of THIS token can still be borrowed
  function pctGroupHtml(targetId, sym, mode){
    return `<span class="pct-group" data-target="${targetId}" data-sym="${sym}" data-mode="${mode}">
      <button type="button" class="pct-btn" data-pct="25">25%</button>
      <button type="button" class="pct-btn" data-pct="50">50%</button>
      <button type="button" class="pct-btn" data-pct="100">Max</button>
    </span>`;
  }

  // One delegated listener handles every pct-group, including ones rendered later —
  // renderLendRows()/renderBorrowRows() rebuild their containers' innerHTML often, which
  // would silently drop individually-bound listeners.
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".pct-btn");
    if (!btn) return;
    const group = btn.closest(".pct-group[data-target]");
    if (!group) return; // the swap "You pay" pct-group is handled separately above
    const targetInput = el(group.dataset.target);
    const sym = group.dataset.sym;
    const mode = group.dataset.mode;
    const pct = Number(btn.dataset.pct) / 100;
    if (!targetInput || !sym) return;

    if (mode === "wallet") {
      const bal = balances[sym] || 0;
      targetInput.value = pct === 1 ? String(bal) : (bal * pct).toFixed(6);
      return;
    }

    if (mode === "borrowmax") {
      const originalPlaceholder = targetInput.placeholder;
      targetInput.placeholder = "Calculating…";
      try {
        const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, readProvider);
        const [maxUsd, price] = await Promise.all([
          withRetry(() => lending.getMaxBorrowableUSD(userAddress)),
          withRetry(() => lending.tokenPriceUSD(TOKENS[sym].address))
        ]);
        if (price === 0n) { targetInput.placeholder = originalPlaceholder; return; }
        const maxUsdNum = Number(ethers.formatUnits(maxUsd, 6));
        const priceNum = Number(ethers.formatUnits(price, 6));
        const maxTokenAmt = maxUsdNum / priceNum;
        targetInput.value = pct === 1 ? maxTokenAmt.toFixed(6) : (maxTokenAmt * pct).toFixed(6);
      } catch (err) {
        console.error("Could not calculate max borrowable amount for", sym, err);
      }
      targetInput.placeholder = originalPlaceholder;
    }
  });

  window.__lendDeposit = async function(sym){
    clearErr("lendErr");
    const val = el("lendAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("lendErr","Enter an amount first."); return; }
    try {
      const amt = parse(sym, val);
      await ensureApproval(sym, LENDING_ADDRESS, amt);
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.deposit(TOKENS[sym].address, amt);
      await requireSuccess(tx);
      showSuccess("lendSuccess","lendSuccessMsg","Deposited " + val + " " + sym);
      await refreshAllAfterTx();
    } catch(err){ console.error(err); showErr("lendErr", err.shortMessage || "Deposit failed."); }
  };
  window.__lendWithdraw = async function(sym){
    clearErr("lendErr");
    const val = el("lendAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("lendErr","Enter an amount first."); return; }
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.withdraw(TOKENS[sym].address, parse(sym, val));
      await requireSuccess(tx);
      showSuccess("lendSuccess","lendSuccessMsg","Withdrew " + val + " " + sym);
      await refreshAllAfterTx();
    } catch(err){ console.error(err); showErr("lendErr", err.shortMessage || "Withdraw failed."); }
  };
  // ---------- Claim confirmation modal ----------
  const claimModalOverlay = el("claimModalOverlay");
  const claimModalAmount = el("claimModalAmount");
  const claimModalConfirm = el("claimModalConfirm");
  const claimModalCancel = el("claimModalCancel");
  let pendingClaimSym = null;

  function closeClaimModal(){
    claimModalOverlay.classList.remove("show");
    pendingClaimSym = null;
  }
  claimModalCancel.addEventListener("click", closeClaimModal);
  claimModalOverlay.addEventListener("click", (e) => { if (e.target === claimModalOverlay) closeClaimModal(); });

  window.__lendClaim = async function(sym){
    clearErr("lendErr");
    pendingClaimSym = sym;
    claimModalAmount.textContent = "Loading…";
    claimModalOverlay.classList.add("show");
    try {
      // Read the freshest interest figure right before showing it, rather than relying on
      // whatever was last rendered in the row (which could be a few seconds stale).
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, readProvider);
      const [, interest] = await withRetry(() => lending.getDepositBalance(userAddress, TOKENS[sym].address));
      claimModalAmount.textContent = fmt(sym, interest).toFixed(6) + " " + sym;
    } catch (err) {
      console.error(err);
      claimModalAmount.textContent = "Couldn't load amount";
    }
  };

  claimModalConfirm.addEventListener("click", async () => {
    const sym = pendingClaimSym;
    if (!sym) return;
    clearErr("lendErr");
    claimModalConfirm.disabled = true;
    claimModalConfirm.textContent = "Claiming…";
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.claimInterest(TOKENS[sym].address);
      await requireSuccess(tx);
      closeClaimModal();
      showSuccess("lendSuccess","lendSuccessMsg","Interest claimed for " + sym);
      await refreshAllAfterTx();
    } catch(err){
      console.error(err);
      closeClaimModal();
      showErr("lendErr", err.shortMessage || "Claim failed.");
    }
    claimModalConfirm.disabled = false;
    claimModalConfirm.textContent = "Confirm Claim";
  });

  // FIX: same silent-zero problem existed here for collateral + borrow balances — fixed the
  // same way (sequential calls, surfaced failures instead of hardcoded 0n).
  async function renderBorrowRows(){
    const cContainer = el("collateralRows");
    const bContainer = el("borrowRows");
    if (!signer) {
      cContainer.innerHTML = '<div class="err-line show" style="color:var(--text-faint)">Connect your wallet to view collateral.</div>';
      bContainer.innerHTML = "";
      return;
    }
    const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, readProvider);

    try {
      const cv = await withRetry(() => lending.getCollateralValueUSD(userAddress));
      const bv = await withRetry(() => lending.getBorrowValueUSD(userAddress));
      const mb = await withRetry(() => lending.getMaxBorrowableUSD(userAddress));
      el("collateralValueUSD").textContent = "$" + Number(ethers.formatUnits(cv,6)).toFixed(2);
      el("borrowValueUSD").textContent = "$" + Number(ethers.formatUnits(bv,6)).toFixed(2);
      el("maxBorrowUSD").textContent = "$" + Number(ethers.formatUnits(mb,6)).toFixed(2);
    } catch(e){ console.error(e); }

    const colResults = await sequential(TOKEN_LIST, async sym => {
      try { return [sym, await withRetry(() => lending.collateral(userAddress, TOKENS[sym].address)), false]; }
      catch(e){ console.error("collateral read failed for", sym, e); return [sym, 0n, true]; }
    });
    const colBySym = {}, colFailedBySym = {};
    colResults.forEach(([sym, val, failed]) => { colBySym[sym] = val; colFailedBySym[sym] = failed; });
    let cHtml = "";
    for (const sym of TOKEN_LIST) {
      const colAmt = colBySym[sym];
      const statsHtml = colFailedBySym[sym]
        ? `<span style="color:var(--warn,#e0a030);">Couldn't load — <a href="#" onclick="window.__retryBorrow();return false;">tap to retry</a></span>`
        : `Wallet: ${(balances[sym]||0).toFixed(4)}<br>Locked: ${fmt(sym,colAmt).toFixed(4)}`;
      cHtml += `
        <div class="token-row">
          <div class="token-row-head">
            <div class="token-chip"><span class="token-dot" style="background:${TOKENS[sym].color}">${sym[0]}</span><span class="token-name">${sym}</span></div>
            <div class="token-stats">${statsHtml}</div>
          </div>
          <div class="token-input-row">
            <input type="text" inputmode="decimal" placeholder="Amount" id="colAmt-${sym}">
            ${pctGroupHtml("colAmt-" + sym, sym, "wallet")}
          </div>
          <div class="btn-row">
            <button class="btn" style="flex:1;" onclick="window.__depositCollateral('${sym}')">Deposit</button>
            <button class="btn ghost" style="flex:1;" onclick="window.__withdrawCollateral('${sym}')">Withdraw</button>
          </div>
        </div>`;
    }
    cContainer.innerHTML = cHtml;

    const borResults = await sequential(TOKEN_LIST, async sym => {
      try { return [sym, await withRetry(() => lending.getBorrowBalance(userAddress, TOKENS[sym].address)), false]; }
      catch(e){ console.error("getBorrowBalance failed for", sym, e); return [sym, [0n, 0n], true]; }
    });
    const borBySym = {}, borFailedBySym = {};
    borResults.forEach(([sym, data, failed]) => { borBySym[sym] = data; borFailedBySym[sym] = failed; });
    let bHtml = "";
    for (const sym of TOKEN_LIST) {
      const [principal, interest] = borBySym[sym];
      const statsHtml = borFailedBySym[sym]
        ? `<span style="color:var(--warn,#e0a030);">Couldn't load — <a href="#" onclick="window.__retryBorrow();return false;">tap to retry</a></span>`
        : `Borrowed: ${fmt(sym,principal).toFixed(4)}<br>Interest: ${fmt(sym,interest).toFixed(6)}`;
      bHtml += `
        <div class="token-row">
          <div class="token-row-head">
            <div class="token-chip"><span class="token-dot" style="background:${TOKENS[sym].color}">${sym[0]}</span><span class="token-name">${sym}</span></div>
            <div class="token-stats">${statsHtml}</div>
          </div>
          <div class="token-input-row">
            <input type="text" inputmode="decimal" placeholder="Amount" id="borAmt-${sym}">
            ${pctGroupHtml("borAmt-" + sym, sym, "borrowmax")}
          </div>
          <div class="btn-row">
            <button class="btn" style="flex:1;" onclick="window.__borrow('${sym}')">Borrow</button>
            <button class="btn ghost" style="flex:1;" onclick="window.__repay('${sym}')">Repay</button>
          </div>
        </div>`;
    }
    bContainer.innerHTML = bHtml;
  }

  window.__depositCollateral = async function(sym){
    clearErr("borrowErr");
    const val = el("colAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("borrowErr","Enter an amount first."); return; }
    try {
      const amt = parse(sym, val);
      await ensureApproval(sym, LENDING_ADDRESS, amt);
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.depositCollateral(TOKENS[sym].address, amt);
      await requireSuccess(tx);
      showSuccess("borrowSuccess","borrowSuccessMsg","Collateral deposited: " + val + " " + sym);
      await refreshAllAfterTx();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Deposit failed."); }
  };
  window.__withdrawCollateral = async function(sym){
    clearErr("borrowErr");
    const val = el("colAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("borrowErr","Enter an amount first."); return; }
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.withdrawCollateral(TOKENS[sym].address, parse(sym, val));
      await requireSuccess(tx);
      showSuccess("borrowSuccess","borrowSuccessMsg","Collateral withdrawn: " + val + " " + sym);
      await refreshAllAfterTx();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Withdraw failed — check collateral ratio."); }
  };
  window.__borrow = async function(sym){
    clearErr("borrowErr");
    const val = el("borAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("borrowErr","Enter an amount first."); return; }
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.borrow(TOKENS[sym].address, parse(sym, val));
      await requireSuccess(tx);
      showSuccess("borrowSuccess","borrowSuccessMsg","Borrowed " + val + " " + sym);
      await refreshAllAfterTx();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Borrow failed — check collateral."); }
  };
  window.__repay = async function(sym){
    clearErr("borrowErr");
    const val = el("borAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("borrowErr","Enter an amount first."); return; }
    try {
      const amt = parse(sym, val);
      await ensureApproval(sym, LENDING_ADDRESS, amt);
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.repay(TOKENS[sym].address, amt);
      await requireSuccess(tx);
      showSuccess("borrowSuccess","borrowSuccessMsg","Repaid " + val + " " + sym);
      await refreshAllAfterTx();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Repay failed."); }
  };

  renderSwapBalances();
})();
