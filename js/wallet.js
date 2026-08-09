'use strict';
/* DemoMask wallet — read-only MetaMask connect + simulated wallet.
   IMPORTANT: this is a DEMO. The MetaMask connection only READS your address.
   No transaction is ever signed, sent, or broadcast. All funds are play money. */

function openWallet() {
  $('#walletOverlay').classList.remove('hidden');
  updateWalletUI();
}
function closeWallet() {
  $('#walletOverlay').classList.add('hidden');
}

function updateWalletUI() {
  const addrEl = $('#wAddr'), typeEl = $('#wType'), balEl = $('#wBal');
  const actions = $('#wActions'), tx = $('#wTx');
  const btn = $('#walletBtn');
  if (App.wallet) {
    addrEl.textContent = App.wallet.address;
    typeEl.textContent = App.wallet.type === 'metamask'
      ? 'MetaMask · read-only demo connection'
      : 'Simulated wallet';
    actions.classList.add('hidden');
    tx.classList.remove('hidden');
    if (btn) btn.innerHTML = '🦊 ' + App.wallet.address.slice(0, 6) + '…' + App.wallet.address.slice(-4);
  } else {
    addrEl.textContent = 'Not connected';
    typeEl.textContent = '';
    actions.classList.remove('hidden');
    tx.classList.add('hidden');
    if (btn) btn.innerHTML = '🦊 Connect';
  }
  if (balEl) balEl.textContent = fmt(App.balance);
}

async function connectMetaMask() {
  if (!window.ethereum) {
    toast('MetaMask not detected — use the simulated wallet instead', 'warn');
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!accounts || !accounts.length) throw new Error('no accounts');
    App.wallet = { address: accounts[0], type: 'metamask', at: Date.now() };
    saveState();
    updateWalletUI();
    updateBalance();
    toast('Connected (read-only — no transactions will ever be sent)');
  } catch (e) {
    toast('MetaMask connection cancelled or failed', 'warn');
  }
}

function connectSimulated() {
  App.wallet = { address: '0x' + randomHex(20), type: 'simulated', at: Date.now() };
  saveState();
  updateWalletUI();
  updateBalance();
  toast('Simulated wallet connected');
}

function disconnectWallet() {
  App.wallet = null;
  saveState();
  updateWalletUI();
  updateBalance();
  toast('Wallet disconnected');
}

/* fake deposits / withdrawals — purely cosmetic demo flows */
async function demoDeposit() {
  await fakeTx('Depositing 10,000 DEMO (demo)…');
  App.balance += 10000;
  saveState();
  updateBalance();
  updateWalletUI();
  toast('＋ 10,000 DEMO deposited (demo)');
}
async function demoWithdraw() {
  if (App.balance < 10000) { toast('Not enough balance to withdraw 10,000', 'warn'); return; }
  await fakeTx('Withdrawing 10,000 DEMO (demo)…');
  App.balance -= 10000;
  saveState();
  updateBalance();
  updateWalletUI();
  toast('− 10,000 DEMO withdrawn (demo)');
}

async function fakeTx(label) {
  const ov = $('#txOverlay');
  const spin = $('#txSpin'), status = $('#txStatus'), hash = $('#txHash'), ok = $('#txOk');
  ov.classList.remove('hidden');
  spin.textContent = '⏳';
  status.textContent = label;
  hash.textContent = '';
  ok.classList.add('hidden');
  await sleep(1400);
  spin.textContent = '✅';
  status.textContent = 'Confirmed (demo)';
  hash.textContent = '0x' + randomHex(32);
  ok.classList.remove('hidden');
}
function closeTx() { $('#txOverlay').classList.add('hidden'); }

/* click outside modals to close */
document.addEventListener('click', (e) => {
  if (e.target.id === 'walletOverlay') closeWallet();
  if (e.target.id === 'txOverlay') closeTx();
});
