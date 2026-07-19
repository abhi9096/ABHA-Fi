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

  const el = id => document.getElementById(id);
  const walletBtn = el("walletBtn");

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      el("panel-" + btn.dataset.tab).classList.add("active");
      if (signer) refreshAll();
    });
  });

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

  async function connectWallet(){
    if (typeof window.ethereum === "undefined") { showErr("swapErr", "No wallet found. Install MetaMask to continue."); return; }
    try {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      await ensureArcNetwork();
      signer = await provider.getSigner();
      userAddress = await signer.getAddress();
      walletBtn.textContent = userAddress.slice(0,6) + "…" + userAddress.slice(-4);
      walletBtn.classList.add("connected");
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
  walletBtn.addEventListener("click", () => { if (!signer) connectWallet(); });

  function tokenContract(sym, runner){ return new ethers.Contract(TOKENS[sym].address, ERC20_ABI, runner); }
  function fmt(sym, raw){ return Number(ethers.formatUnits(raw, TOKENS[sym].decimals)); }
  function parse(sym, val){ return ethers.parseUnits(val, TOKENS[sym].decimals); }

  async function ensureApproval(sym, spender, neededAmount){
    const c = tokenContract(sym, signer);
    const allowance = await c.allowance(userAddress, spender);
    if (allowance < neededAmount) {
      const tx = await c.approve(spender, MAX_UINT);
      await tx.wait();
    }
  }

  async function refreshAll(){
    if (!signer) return;
    for (const sym of TOKEN_LIST) {
      try { balances[sym] = fmt(sym, await tokenContract(sym, provider).balanceOf(userAddress)); }
      catch(e){ balances[sym] = 0; }
    }
    renderSwapBalances();
    renderLiquidityPanel();
    renderLendRows();
    renderBorrowRows();
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
  el("maxBtn").addEventListener("click", () => {
    if (balances[direction.from]) { el("amountIn").value = balances[direction.from]; onAmountChange(); }
  });

  let estimateTimer;
  el("amountIn").addEventListener("input", () => { clearTimeout(estimateTimer); estimateTimer = setTimeout(onAmountChange, 250); });

  async function onAmountChange(){
    clearErr("swapErr");
    const val = el("amountIn").value;
    if (!val || Number(val) <= 0 || !provider) { el("amountOut").value=""; el("rateLine").textContent=""; updateSwapAction(); return; }
    try {
      const swap = new ethers.Contract(MULTISWAP_ADDRESS, SWAP_ABI, provider);
      const [reserveIn, reserveOut] = await swap.getReserves(TOKENS[direction.from].address, TOKENS[direction.to].address);
      if (reserveIn === 0n || reserveOut === 0n) { el("amountOut").value=""; el("rateLine").textContent="Pool has no liquidity yet."; updateSwapAction(); return; }
      const amtIn = parse(direction.from, val);
      const out = await swap.getAmountOut(amtIn, reserveIn, reserveOut);
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
      const c = tokenContract(direction.from, provider);
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
      await tx.wait();
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
      await tx.wait();
      showSuccess("swapSuccess","swapSuccessMsg","Swap complete — " + direction.from + " → " + direction.to);
      el("amountIn").value=""; el("amountOut").value=""; el("rateLine").textContent="";
      await refreshAll();
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
        const swap = new ethers.Contract(MULTISWAP_ADDRESS, SWAP_ABI, provider);
        const [rA, rB] = await swap.getReserves(TOKENS[a].address, TOKENS[b].address);
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
      await tx.wait();
      showSuccess("liqSuccess","liqSuccessMsg","Liquidity added to " + a + "/" + b);
      el("liqAmountA").value=""; el("liqAmountB").value="";
      await refreshAll();
    } catch (err) { console.error(err); showErr("liqErr", err.shortMessage || "Adding liquidity failed."); }
    updateLiqAction();
  }

  async function renderLendRows(){
    const container = el("lendRows");
    if (!signer) { container.innerHTML = '<div class="err-line show" style="color:var(--text-faint)">Connect your wallet to view lending.</div>'; return; }
    const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, provider);
    let html = "";
    for (const sym of TOKEN_LIST) {
      let principal = 0n, interest = 0n;
      try { [principal, interest] = await lending.getDepositBalance(userAddress, TOKENS[sym].address); } catch(e){}
      html += `
        <div class="token-row">
          <div class="token-row-head">
            <div class="token-chip"><span class="token-dot" style="background:${TOKENS[sym].color}">${sym[0]}</span><span class="token-name">${sym}</span></div>
            <div class="token-stats">Deposited: ${fmt(sym,principal).toFixed(4)}<br>Interest: ${fmt(sym,interest).toFixed(6)}</div>
          </div>
          <div class="token-input-row">
            <input type="text" inputmode="decimal" placeholder="Amount" id="lendAmt-${sym}">
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

  window.__lendDeposit = async function(sym){
    clearErr("lendErr");
    const val = el("lendAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("lendErr","Enter an amount first."); return; }
    try {
      const amt = parse(sym, val);
      await ensureApproval(sym, LENDING_ADDRESS, amt);
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.deposit(TOKENS[sym].address, amt);
      await tx.wait();
      showSuccess("lendSuccess","lendSuccessMsg","Deposited " + val + " " + sym);
      await refreshAll();
    } catch(err){ console.error(err); showErr("lendErr", err.shortMessage || "Deposit failed."); }
  };
  window.__lendWithdraw = async function(sym){
    clearErr("lendErr");
    const val = el("lendAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("lendErr","Enter an amount first."); return; }
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.withdraw(TOKENS[sym].address, parse(sym, val));
      await tx.wait();
      showSuccess("lendSuccess","lendSuccessMsg","Withdrew " + val + " " + sym);
      await refreshAll();
    } catch(err){ console.error(err); showErr("lendErr", err.shortMessage || "Withdraw failed."); }
  };
  window.__lendClaim = async function(sym){
    clearErr("lendErr");
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.claimInterest(TOKENS[sym].address);
      await tx.wait();
      showSuccess("lendSuccess","lendSuccessMsg","Interest claimed for " + sym);
      await refreshAll();
    } catch(err){ console.error(err); showErr("lendErr", err.shortMessage || "Claim failed."); }
  };

  async function renderBorrowRows(){
    const cContainer = el("collateralRows");
    const bContainer = el("borrowRows");
    if (!signer) {
      cContainer.innerHTML = '<div class="err-line show" style="color:var(--text-faint)">Connect your wallet to view collateral.</div>';
      bContainer.innerHTML = "";
      return;
    }
    const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, provider);

    try {
      const cv = await lending.getCollateralValueUSD(userAddress);
      const bv = await lending.getBorrowValueUSD(userAddress);
      const mb = await lending.getMaxBorrowableUSD(userAddress);
      el("collateralValueUSD").textContent = "$" + Number(ethers.formatUnits(cv,6)).toFixed(2);
      el("borrowValueUSD").textContent = "$" + Number(ethers.formatUnits(bv,6)).toFixed(2);
      el("maxBorrowUSD").textContent = "$" + Number(ethers.formatUnits(mb,6)).toFixed(2);
    } catch(e){ console.error(e); }

    let cHtml = "";
    for (const sym of TOKEN_LIST) {
      let colAmt = 0n;
      try { colAmt = await lending.collateral(userAddress, TOKENS[sym].address); } catch(e){}
      cHtml += `
        <div class="token-row">
          <div class="token-row-head">
            <div class="token-chip"><span class="token-dot" style="background:${TOKENS[sym].color}">${sym[0]}</span><span class="token-name">${sym}</span></div>
            <div class="token-stats">Wallet: ${(balances[sym]||0).toFixed(4)}<br>Locked: ${fmt(sym,colAmt).toFixed(4)}</div>
          </div>
          <div class="token-input-row"><input type="text" inputmode="decimal" placeholder="Amount" id="colAmt-${sym}"></div>
          <div class="btn-row">
            <button class="btn" style="flex:1;" onclick="window.__depositCollateral('${sym}')">Deposit</button>
            <button class="btn ghost" style="flex:1;" onclick="window.__withdrawCollateral('${sym}')">Withdraw</button>
          </div>
        </div>`;
    }
    cContainer.innerHTML = cHtml;

    let bHtml = "";
    for (const sym of TOKEN_LIST) {
      let principal = 0n, interest = 0n;
      try { [principal, interest] = await lending.getBorrowBalance(userAddress, TOKENS[sym].address); } catch(e){}
      bHtml += `
        <div class="token-row">
          <div class="token-row-head">
            <div class="token-chip"><span class="token-dot" style="background:${TOKENS[sym].color}">${sym[0]}</span><span class="token-name">${sym}</span></div>
            <div class="token-stats">Borrowed: ${fmt(sym,principal).toFixed(4)}<br>Interest: ${fmt(sym,interest).toFixed(6)}</div>
          </div>
          <div class="token-input-row"><input type="text" inputmode="decimal" placeholder="Amount" id="borAmt-${sym}"></div>
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
      await tx.wait();
      showSuccess("borrowSuccess","borrowSuccessMsg","Collateral deposited: " + val + " " + sym);
      await refreshAll();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Deposit failed."); }
  };
  window.__withdrawCollateral = async function(sym){
    clearErr("borrowErr");
    const val = el("colAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("borrowErr","Enter an amount first."); return; }
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.withdrawCollateral(TOKENS[sym].address, parse(sym, val));
      await tx.wait();
      showSuccess("borrowSuccess","borrowSuccessMsg","Collateral withdrawn: " + val + " " + sym);
      await refreshAll();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Withdraw failed — check collateral ratio."); }
  };
  window.__borrow = async function(sym){
    clearErr("borrowErr");
    const val = el("borAmt-" + sym).value;
    if (!val || Number(val) <= 0) { showErr("borrowErr","Enter an amount first."); return; }
    try {
      const lending = new ethers.Contract(LENDING_ADDRESS, LENDING_ABI, signer);
      const tx = await lending.borrow(TOKENS[sym].address, parse(sym, val));
      await tx.wait();
      showSuccess("borrowSuccess","borrowSuccessMsg","Borrowed " + val + " " + sym);
      await refreshAll();
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
      await tx.wait();
      showSuccess("borrowSuccess","borrowSuccessMsg","Repaid " + val + " " + sym);
      await refreshAll();
    } catch(err){ console.error(err); showErr("borrowErr", err.shortMessage || "Repay failed."); }
  };

  renderSwapBalances();
})();
