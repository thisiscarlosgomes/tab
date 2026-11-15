"use client";
import { MessageText } from "./MessageText";
import { useState } from "react";
import { CheckCircle2, ChevronDown, Search } from "lucide-react";
import report from "@/lib/dinner/agent-test-report.json";
import styles from "./AgentTests.module.css";

export function AgentTests() {
  const [view, setView] = useState<"conversations" | "automated">("conversations");
  const [search, setSearch] = useState("");
  const query = search.toLowerCase();
  const conversations = report.browser.filter(item => `${item.question} ${item.replyTo ?? ""} ${item.reply} ${item.category}`.toLowerCase().includes(query));
  return (
    <section className={styles.page}>
      <a className={styles.back} href="/app/settings/agent">← Agent settings</a>
      <header>
        <p className={styles.eyebrow}>TAB AGENT</p>
        <h1>Conversation tests</h1>
        <p className={styles.intro}>See what Tab was asked, what it answered, and what we checked.</p>
      </header>
      <div className={styles.summary}>
        <CheckCircle2 size={22} aria-hidden="true" />
        <div><strong>Latest recorded checks passed</strong><p>{report.model} · Isolated test rooms</p></div>
      </div>
      <p className={styles.note}>Recorded {new Date(report.recordedAt).toLocaleString("en-GB", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })} (Shanghai). These are saved test results, not a live run. All conversation examples use synthetic accounts.</p>
      <div className={styles.controls}>
        <div className={styles.tabs} aria-label="Test views">
          <button type="button" aria-pressed={view === "conversations"} onClick={() => setView("conversations")}>Conversations <span>{report.browser.length}</span></button>
          <button type="button" aria-pressed={view === "automated"} onClick={() => setView("automated")}>Automated checks</button>
        </div>
        <label className={styles.search}><Search size={16} aria-hidden="true" /><input aria-label="Search tests" placeholder="Search tests" value={search} onChange={event => setSearch(event.target.value)} /></label>
      </div>
      {view === "conversations" ? <div className={styles.list}>
        {conversations.length === 0 && <p>No conversations match your search.</p>}
        {conversations.map((item, index) => <details className={styles.card} key={`${item.category}:${item.question}`} open={index === 0 && !search}>
          <summary><div><span className={styles.category}>{item.category}</span><h2>{item.question}</h2></div><span className={styles.pass}>{item.passed ? "Passed" : "Failed"}</span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className={styles.body}>
            {item.category === "Older replies" && <p className={styles.context}>Two bills from different members, followed by 30 intervening messages. The user replies to the older Tab message without @Tab.</p>}
            {item.replyTo && <blockquote><span>Replying to Tab</span>{item.replyTo}</blockquote>}
            <div className={styles.user}><span>Alice</span><p>{item.question}</p></div>
            <div className={styles.agent}><span>Tab · actual response</span><MessageText text={item.reply} /></div>
            <div className={styles.expected}><strong>Expected behavior</strong><p>{item.expected}</p></div>
          </div>
        </details>)}
      </div> : <div className={styles.list}>
        <p className={styles.note}>Runs overlap; their totals are shown separately rather than added together.</p>
        {report.runs.map(run => {
          const cases = run.cases.filter(item => item.name.toLowerCase().includes(query));
          return <section className={styles.card} key={run.title}><div className={styles.runHeading}><h2>{run.title}</h2><span className={styles.pass}>{run.passed}/{run.total} passed</span></div>
            {cases.length ? <ul className={styles.cases}>{cases.map(item => <li key={item.name}><CheckCircle2 size={16} aria-label={item.passed ? "Passed" : "Failed"} /><span>{item.name}</span></li>)}</ul> : <p className={styles.body}>No checks match your search.</p>}
          </section>;
        })}
      </div>}
      <footer className={styles.footer}>{report.checks.map(check => <span key={check}><CheckCircle2 size={14} aria-hidden="true" />{check}</span>)}</footer>
    </section>
  );
}
