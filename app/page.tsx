"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

type TradeStatus = "Draft" | "Funded" | "In transit" | "Ready to release" | "Settled";

type Trade = {
  id: number;
  reference: string;
  partner: string;
  corridor: string;
  amount: number;
  status: TradeStatus;
  eta: string;
  wallet: string;
  progress: number;
};

const ARC_CHAIN_ID = "0x4ce392"; // 5042002
const ARC_EXPLORER = "https://testnet.arcscan.app";
const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_ADDRESS ?? "";

const initialTrades: Trade[] = [
  {
    id: 2841,
    reference: "PO-2841",
    partner: "Shenzhen Aster Components",
    corridor: "UAE → China",
    amount: 12840,
    status: "Ready to release",
    eta: "Inspection passed",
    wallet: "0x4C9fA782E27B791A92b2e067cf9D0A8A72F50391",
    progress: 82,
  },
  {
    id: 2836,
    reference: "INV-2836",
    partner: "Atlas Textiles FZCO",
    corridor: "India → UAE",
    amount: 7250,
    status: "In transit",
    eta: "Arrives in 2 days",
    wallet: "0x72A0cFF66d2B1a8E7A1E119E2f62f4F512eB58a1",
    progress: 58,
  },
  {
    id: 2827,
    reference: "PO-2827",
    partner: "Mombasa Coffee Collective",
    corridor: "Kenya → UAE",
    amount: 4960,
    status: "Settled",
    eta: "Settled in 0.7 sec",
    wallet: "0x184e07D817646Dd3314368E14e3C2B796b5d8831",
    progress: 100,
  },
];

const statusClass: Record<TradeStatus, string> = {
  Draft: "slate",
  Funded: "blue",
  "In transit": "amber",
  "Ready to release": "teal",
  Settled: "green",
};

function compactAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function toHex32(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function encodeAddress(value: string) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function textToBytes32(value: string) {
  const bytes = new TextEncoder().encode(value.slice(0, 32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").padEnd(64, "0");
}

function usdcToWei(amount: number) {
  const [whole, decimal = ""] = amount.toFixed(2).split(".");
  return BigInt(`${whole}${decimal.padEnd(18, "0")}`);
}

export default function Home() {
  const [trades, setTrades] = useState(initialTrades);
  const [activeView, setActiveView] = useState("Overview");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [wallet, setWallet] = useState("");
  const [showNewTrade, setShowNewTrade] = useState(false);
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("tradeflow-demo-trades");
    if (stored) {
      try {
        setTrades(JSON.parse(stored) as Trade[]);
      } catch {
        window.localStorage.removeItem("tradeflow-demo-trades");
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("tradeflow-demo-trades", JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const metrics = useMemo(() => {
    const escrow = trades.filter((trade) => trade.status !== "Settled" && trade.status !== "Draft").reduce((sum, trade) => sum + trade.amount, 0);
    const settled = trades.filter((trade) => trade.status === "Settled").reduce((sum, trade) => sum + trade.amount, 0);
    return { escrow, settled, active: trades.filter((trade) => trade.status !== "Settled").length };
  }, [trades]);

  async function switchToArc() {
    if (!window.ethereum) throw new Error("Install a browser wallet to use live mode.");
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID }] });
    } catch {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARC_CHAIN_ID,
            chainName: "Arc Testnet",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: ["https://rpc.testnet.arc.network"],
            blockExplorerUrls: [ARC_EXPLORER],
          },
        ],
      });
    }
  }

  async function connectWallet() {
    try {
      await switchToArc();
      const accounts = (await window.ethereum?.request({ method: "eth_requestAccounts" })) as string[];
      setWallet(accounts?.[0] ?? "");
      setMode("live");
      setToast("Wallet connected to Arc Testnet.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Wallet connection was cancelled.");
    }
  }

  async function sendContractTransaction(data: string, value = 0n) {
    if (!window.ethereum || !wallet) throw new Error("Connect your wallet first.");
    if (!ESCROW_ADDRESS) throw new Error("Live escrow will unlock after the contract address is added.");
    return (await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: wallet, to: ESCROW_ADDRESS, value: `0x${value.toString(16)}`, data }],
    })) as string;
  }

  async function advanceTrade(trade: Trade) {
    setBusyId(trade.id);
    try {
      const nextStatus: Record<TradeStatus, TradeStatus> = {
        Draft: "Funded",
        Funded: "In transit",
        "In transit": "Ready to release",
        "Ready to release": "Settled",
        Settled: "Settled",
      };

      let transactionHash = "";
      if (mode === "live") {
        if (!wallet) {
          await connectWallet();
          throw new Error("Wallet connected. Select the action again to confirm it.");
        }
        if (trade.status === "Draft") {
          const arbitrator = wallet;
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
          const data = `0x197ab578${encodeAddress(trade.wallet)}${encodeAddress(arbitrator)}${textToBytes32(trade.reference)}${toHex32(deadline)}`;
          transactionHash = await sendContractTransaction(data, usdcToWei(trade.amount));
        } else {
          const selector = trade.status === "Funded" ? "93ef8d21" : trade.status === "In transit" ? "74950ffd" : "67d42a8b";
          transactionHash = await sendContractTransaction(`0x${selector}${textToBytes32(trade.reference)}`);
        }
      }

      setTrades((current) =>
        current.map((item) =>
          item.id === trade.id
            ? {
                ...item,
                status: nextStatus[item.status],
                progress: Math.min(100, item.progress + 24),
                eta: nextStatus[item.status] === "Settled" ? "Settled in under 1 sec" : item.eta,
              }
            : item,
        ),
      );
      setToast(transactionHash ? `Transaction submitted: ${compactAddress(transactionHash)}` : `${trade.reference} moved to ${nextStatus[trade.status]}.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "That action could not be completed.");
    } finally {
      setBusyId(null);
    }
  }

  function createTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextId = Math.max(...trades.map((trade) => trade.id)) + 1;
    const amount = Number(form.get("amount"));
    const newTrade: Trade = {
      id: nextId,
      reference: String(form.get("reference")),
      partner: String(form.get("partner")),
      corridor: String(form.get("corridor")),
      amount,
      status: "Draft",
      eta: "Awaiting escrow funding",
      wallet: String(form.get("wallet")),
      progress: 10,
    };
    setTrades((current) => [newTrade, ...current]);
    setShowNewTrade(false);
    setToast(`${newTrade.reference} is ready to fund.`);
  }

  const displayedTrades = activeView === "Settlements" ? trades.filter((trade) => trade.status === "Settled") : trades;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>TradeFlow</span>
        </div>
        <nav aria-label="Primary navigation">
          {["Overview", "Trades", "Settlements", "Compliance"].map((item) => (
            <button key={item} className={activeView === item ? "active" : ""} onClick={() => setActiveView(item)}>
              <span className="nav-dot" aria-hidden="true" />{item}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-card">
            <span className="pulse" />
            <div><strong>Arc Testnet</strong><small>Operational · &lt;1s finality</small></div>
          </div>
          <p>Powered by</p>
          <div className="powered"><span>◉ Circle</span><span>⟲ Arc</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">SME TRADE DESK</p>
            <h1>{activeView}</h1>
          </div>
          <div className="top-actions">
            <div className="mode-switch" aria-label="Transaction mode">
              <button className={mode === "demo" ? "selected" : ""} onClick={() => setMode("demo")}>Demo</button>
              <button className={mode === "live" ? "selected" : ""} onClick={() => setMode("live")}>Live</button>
            </div>
            <button className="wallet-button" onClick={connectWallet}>
              <span className="wallet-led" />{wallet ? compactAddress(wallet) : "Connect wallet"}
            </button>
            <button className="avatar" aria-label="Account menu">MA</button>
          </div>
        </header>

        <div className="content">
          {activeView === "Compliance" ? (
            <ComplianceView />
          ) : (
            <>
              <section className="hero-card">
                <div className="hero-copy">
                  <p className="hero-kicker"><span>●</span> BUILT FOR GCC TRADE CORRIDORS</p>
                  <h2>Trade with certainty.<br />Settle in seconds.</h2>
                  <p>Programmable USDC escrow for importers and suppliers—without slow correspondent banking or payment uncertainty.</p>
                  <div className="hero-actions">
                    <button className="primary" onClick={() => setShowNewTrade(true)}>＋ New trade</button>
                    <button className="secondary" onClick={() => setActiveView("Trades")}>View all trades <span>↗</span></button>
                  </div>
                </div>
                <div className="corridor-visual" aria-label="Trade corridor from Dubai to Shenzhen">
                  <div className="route-label dubai"><span>DXB</span><strong>Dubai</strong><small>Importer</small></div>
                  <div className="route-line"><span className="moving-dot" /><b>USDC escrow</b></div>
                  <div className="route-label shenzhen"><span>SZX</span><strong>Shenzhen</strong><small>Supplier</small></div>
                  <div className="settlement-pill"><strong>0.7s</strong><span>average settlement</span></div>
                </div>
              </section>

              <section className="metrics-grid" aria-label="Portfolio metrics">
                <Metric label="USDC in escrow" value={`$${metrics.escrow.toLocaleString()}`} change="Fully collateralized" tone="teal" />
                <Metric label="Settled this month" value={`$${(metrics.settled + 18340).toLocaleString()}`} change="↑ 18.4% vs last month" tone="green" />
                <Metric label="Active trades" value={String(metrics.active)} change="Across 3 corridors" tone="blue" />
                <Metric label="Fees saved" value="$1,284" change="vs. bank wire estimate" tone="coral" />
              </section>

              <div className="dashboard-grid">
                <section className="panel trades-panel">
                  <div className="panel-heading">
                    <div><p className="eyebrow">LIVE PIPELINE</p><h3>{activeView === "Settlements" ? "Completed settlements" : "Trade activity"}</h3></div>
                    <button onClick={() => setShowNewTrade(true)}>＋ Add trade</button>
                  </div>
                  <div className="trade-list">
                    {displayedTrades.map((trade) => (
                      <article className="trade-row" key={trade.id}>
                        <div className="partner-icon">{trade.partner.slice(0, 2).toUpperCase()}</div>
                        <div className="trade-main">
                          <div className="trade-title"><strong>{trade.partner}</strong><span className={`status ${statusClass[trade.status]}`}>{trade.status}</span></div>
                          <p>{trade.reference} · {trade.corridor} · {trade.eta}</p>
                          <div className="progress"><span style={{ width: `${trade.progress}%` }} /></div>
                        </div>
                        <div className="trade-value"><strong>${trade.amount.toLocaleString()}</strong><small>USDC</small></div>
                        {trade.status !== "Settled" && (
                          <button className="row-action" onClick={() => advanceTrade(trade)} disabled={busyId === trade.id}>
                            {busyId === trade.id ? "Working…" : trade.status === "Draft" ? "Fund" : trade.status === "Ready to release" ? "Release" : "Advance"}
                          </button>
                        )}
                      </article>
                    ))}
                    {displayedTrades.length === 0 && <p className="empty-state">No settled trades yet.</p>}
                  </div>
                </section>

                <aside className="insight-stack">
                  <section className="panel balance-card">
                    <div className="panel-heading"><div><p className="eyebrow">LIQUIDITY</p><h3>Available to deploy</h3></div><span className="mini-icon">$</span></div>
                    <strong className="big-balance">$42,680.00</strong><p>USDC on Arc</p>
                    <div className="balance-bar"><span /></div>
                    <div className="balance-legend"><span>Available <b>66%</b></span><span>In escrow <b>34%</b></span></div>
                    <button onClick={connectWallet}>{wallet ? "Wallet connected" : "Connect treasury wallet"}</button>
                  </section>
                  <section className="panel guard-card">
                    <div className="guard-mark">✓</div>
                    <div><p className="eyebrow">COMPLIANCE GUARD</p><h3>All checks clear</h3><p>Wallet screening, invoice evidence and settlement rules are active.</p></div>
                    <button aria-label="Open compliance" onClick={() => setActiveView("Compliance")}>→</button>
                  </section>
                </aside>
              </div>
            </>
          )}
        </div>
      </section>

      {showNewTrade && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowNewTrade(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-trade-title">
            <button className="modal-close" onClick={() => setShowNewTrade(false)} aria-label="Close">×</button>
            <p className="eyebrow">NEW PROGRAMMABLE ESCROW</p>
            <h2 id="new-trade-title">Open a protected trade</h2>
            <p>Funds stay locked until delivery conditions are met.</p>
            <form onSubmit={createTrade}>
              <label>Supplier name<input name="partner" required placeholder="e.g. Al Noor Packaging" /></label>
              <div className="form-grid">
                <label>Invoice reference<input name="reference" required placeholder="PO-2842" /></label>
                <label>Amount (USDC)<input name="amount" type="number" min="1" step="0.01" required placeholder="12500" /></label>
              </div>
              <label>Trade corridor<select name="corridor" defaultValue="UAE → China"><option>UAE → China</option><option>India → UAE</option><option>Kenya → UAE</option><option>Saudi Arabia → UAE</option></select></label>
              <label>Supplier wallet<input name="wallet" required pattern="0x[a-fA-F0-9]{40}" defaultValue="0x4C9fA782E27B791A92b2e067cf9D0A8A72F50391" /></label>
              <div className="escrow-note"><span>⌁</span><p><strong>Arc-native settlement</strong><br />USDC is held by the TradeFlow escrow contract and released by verified milestone.</p></div>
              <button className="primary submit" type="submit">Create trade</button>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}

function Metric({ label, value, change, tone }: { label: string; value: string; change: string; tone: string }) {
  return <article className="metric-card"><div className={`metric-symbol ${tone}`}>⌁</div><div><p>{label}</p><strong>{value}</strong><small className={tone}>{change}</small></div></article>;
}

function ComplianceView() {
  const checks = [
    ["Counterparty wallet screening", "Clear", "TRM-ready policy hook"],
    ["Invoice evidence", "Verified", "Document hash recorded"],
    ["Sanctions & country policy", "Clear", "UAE / China corridor"],
    ["Release controls", "Active", "Buyer + arbitrator fallback"],
  ];
  return (
    <section className="compliance-view">
      <div className="compliance-hero"><div><p className="eyebrow">COMPLIANCE-BY-DESIGN</p><h2>Move fast without losing control.</h2><p>Every settlement pairs programmable rules with an auditable evidence trail.</p></div><div className="score-ring"><strong>96</strong><span>risk score</span></div></div>
      <div className="compliance-grid">
        <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PRE-FLIGHT CHECKS</p><h3>PO-2841</h3></div><span className="status green">Ready</span></div>{checks.map(([name, status, note]) => <div className="check-row" key={name}><span className="check-icon">✓</span><div><strong>{name}</strong><p>{note}</p></div><b>{status}</b></div>)}</section>
        <section className="panel policy-card"><p className="eyebrow">SETTLEMENT POLICY</p><h3>Three layers of protection</h3><div className="policy-step"><span>01</span><div><strong>Evidence-gated release</strong><p>Shipment and inspection proofs are hashed before funds move.</p></div></div><div className="policy-step"><span>02</span><div><strong>Time-bound arbitration</strong><p>Stalled trades can enter transparent dispute resolution.</p></div></div><div className="policy-step"><span>03</span><div><strong>Onchain audit trail</strong><p>Every action is timestamped on Arc Testnet.</p></div></div></section>
      </div>
    </section>
  );
}
