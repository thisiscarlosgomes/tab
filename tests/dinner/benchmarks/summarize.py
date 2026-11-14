"""Summarize matched live runs; prices are USD per million tokens, checked 2026-11-10."""
import json, statistics, pathlib, sys
main_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/tab-model-benchmark-final')
held_dir = pathlib.Path('/tmp/tab-model-heldout')
browser_dir = pathlib.Path('/tmp/tab-model-browser-benchmark')
prices = {
 'gpt-4o-mini': {'input': .15, 'cached': .075, 'output': .60},
 'gpt-4.1-mini': {'input': .40, 'cached': .10, 'output': 1.60},
 'gpt-5.4-nano': {'input': .20, 'cached': .02, 'output': 1.25},
 'gpt-5.4-mini': {'input': .75, 'cached': .075, 'output': 4.50},
}
runs = json.loads((main_dir/'results.json').read_text())['results']
held = json.loads((held_dir/'results.json').read_text())['results'] if (held_dir/'results.json').exists() else []
browser = json.loads((browser_dir/'results.json').read_text()) if (browser_dir/'results.json').exists() else []
summary = {'productionModel': 'gpt-4o-mini', 'priceChecked': '2026-11-10', 'pricesPerMillionTokens': prices,
 'priceSources': {m: 'https://developers.openai.com/api/docs/models/'+m for m in prices},
 'method': {'matchedRounds': 2, 'matchedScenarios': 14, 'heldOutScenarios': 2, 'isolatedDatabase': True, 'productionChanged': False,
 'scope': 'Real configured provider calls through DinnerAgentService/runtime/database, plus browser/API lookup/deletion journeys for every model.',
 'controls': 'Identical application code, prompts, server guards, synthetic fixtures and output caps; candidate order rotated by scenario and round. SDK omits unsupported temperature for GPT-5.4 models; no request mutation or custom reasoning settings.',
 'limitations': ['Small sample, not a statistical guarantee.', 'Receipt OCR is seeded identically: this evaluates chat/routing/tools, not image recognition.', 'Many financial replies are intentionally server-rendered; pass rate measures the full app, not unrestricted model intelligence.', 'Latency is local backend reply time, not production/mobile network latency.', 'Cost is an estimate at standard API prices using returned token usage; not an invoice.', 'Only OpenAI credentials were available; other providers were not live-tested.']}, 'models': []}
for model, p in prices.items():
 rows=[r for r in runs if r['approach']==model]
 calls=[c for r in rows for c in r['apiCalls']]
 times=[t for r in rows for t in r['turnTimings']]
 cost=sum(((c['input']-c['cached'])*p['input']+c['cached']*p['cached']+c['output']*p['output'])/1e6 for c in calls)
 responses=len(times)+sum(r['scenario']=='smart-offer' for r in rows)
 h=[r for r in held if r['approach']==model]
 b=next((r for r in browser if r['model']==model),None)
 item={'model':model,'matchedPassed':sum(r['pass'] for r in rows),'matchedTotal':len(rows),
 'heldOutPassed':sum(r['pass'] for r in h),'heldOutTotal':len(h),'browserPassed':b['pass'] if b else None,
 'medianReplyMs':round(statistics.median(times)) if times else None,'p95ReplyMs':sorted(times)[max(0,__import__('math').ceil(len(times)*.95)-1)] if times else None,
 'matchedApiCalls':len(calls),'usage':{key:sum(c[key] for c in calls) for key in ['input','cached','output','reasoning']},
 'estimatedMatchedCostUsd':cost,'estimatedUsdPer1000AssistantTurns':cost/responses*1000 if responses else None,
 'failures':[{'scenario':r['scenario'],'round':r['round'],'failure':r['failure'],'replies':r['replies'],'trace':r['trace']} for r in rows+h if not r['pass']]}
 summary['models'].append(item)
(main_dir/'summary.json').write_text(json.dumps(summary,indent=2))
for r in summary['models']:
 print(f"{r['model']}: {r['matchedPassed']}/{r['matchedTotal']}, held-out {r['heldOutPassed']}/{r['heldOutTotal']}, browser {r['browserPassed']}, median {r['medianReplyMs']}ms, est ${r['estimatedUsdPer1000AssistantTurns']:.3f}/1000 turns")
