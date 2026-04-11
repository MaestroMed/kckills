# KCKILLS — API Monitoring Cheatsheet

Version 1 — 11 avril 2026
But : surveiller la consommation des cles API + budgets pour que le worker
ne te coute jamais rien d'inattendu.

---

## 📊 Les 5 dashboards a checker 1x/semaine

| # | Service | URL | Limite critique |
|---|---------|-----|-----------------|
| 1 | **Google AI Studio (Gemini)** | https://aistudio.google.com/apikey | 1000 RPD / 15 RPM |
| 2 | **Google Cloud Console (YouTube API + Billing)** | https://console.cloud.google.com/billing | 10 000 quota units / jour |
| 3 | **Supabase** | https://supabase.com/dashboard/project/_/settings/usage | 500 MB DB / 5 GB egress / mois |
| 4 | **Cloudflare R2** | https://dash.cloudflare.com/?to=/:account/r2 | 10 GB storage / 1M writes / 10M reads |
| 5 | **Vercel** | https://vercel.com/sconnect1/kckills/usage | 100 GB bandwidth / 100K functions |

---

## 1. Google AI Studio — Gemini 2.5 Flash-Lite

### Limites du free tier
- **15 RPM** (requetes par minute)
- **1000 RPD** (requetes par jour) — reset a 07:00 UTC
- **250K TPM** (tokens par minute)

### Ou voir l'usage
1. https://aistudio.google.com/apikey
2. Clic sur ton API key
3. Onglet **"Usage"**

### Notre budget d'usage par feature
| Feature | Calls / jour | Commentaire |
|---------|--------------|-------------|
| Analyzer (kill clip analysis) | ~30-100 | Un match = ~30 kills, 1 Gemini call par kill |
| Backfill 83 matches | ~2 500 total | Fragmenter sur 3 jours pour rester sous 950 RPD (5% marge) |
| Daemon 24/7 en production | <100/jour | Apres backfill, juste les nouveaux matchs (1-2/semaine) |

### Hard-stop budget
Tu as mis €50 sur Google AI Studio. Le free tier couvre 100% de notre usage
projete — le budget est une ceinture de securite. **Impossible de depasser
si le worker respecte les rate limits.**

Pour forcer un hard-stop : https://console.cloud.google.com/billing → Budgets
& alerts → Create budget → Amount €50 → **cocher "Disable billing when budget
exceeded"**.

---

## 2. Google Cloud Console — YouTube Data API v3

### Limites
- **10 000 quota units / jour** (reset minuit Pacific = 09:00 Paris)

### Cout par endpoint
| Endpoint | Cost | Usage KCKILLS |
|----------|------|---------------|
| `search.list` | **100 units** | Utiliser UNIQUEMENT en fallback, pas le defaut |
| `videos.list` | 1 unit | OK, peut etre appele souvent |
| `channels.list` | 1 unit | OK |

### Budget d'usage
- Worker normal : getEventDetails (LEC API gratuit) fournit le videoID YouTube direct, **pas besoin de search**
- Fallback search : ~5 calls/jour max → 500 unites/jour = 5% du quota
- Backfill complet : ~200 unites total

### Hard-stop
Google Cloud Console → **Billing → Budgets & alerts**. Tu as mis €50, donc
aucun risque de facturation surprise. L'API YouTube est 100% gratuite sous
10K units/jour.

---

## 3. Supabase — DB + Egress

### Limites free tier
- **Database size : 500 MB**
- **Bandwidth (egress) : 5 GB / mois** ← LE vrai bottleneck critique
- **MAU : 50 000** (monthly active users)

### Notre usage estime
- DB size : ~20 MB pour 2000 kills + ratings + comments
- Egress : ~3-4 GB/mois (calcule dans CLAUDE.md Partie 8)

### Pause apres 7 jours d'inactivite
Le projet free tier se MET EN PAUSE automatiquement apres 7 jours sans
activite. Le worker Python a un heartbeat ping toutes les 6h pour eviter
ca. Si tu arretes le worker plus de 7 jours, le projet se pause et tu dois
le reactiver manuellement.

### Alertes
Settings → Notifications → active les emails pour :
- Database > 80% full
- Egress > 80% du quota mensuel

### Backup manuel
Les backups ne sont PAS inclus en free tier. Une fois par semaine :
```bash
pg_dump -h db.xxx.supabase.co -U postgres -d postgres > backup_$(date +%F).sql
```

---

## 4. Cloudflare R2 — clip storage

### Limites free tier
- **Storage : 10 GB**
- **Class A (writes, list, put) : 1 000 000 ops / mois**
- **Class B (reads, get) : 10 000 000 ops / mois**
- **Egress : ILLIMITE GRATUIT** ← killer feature

### Estimations clip storage
| Format | Taille moyenne |
|--------|----------------|
| Horizontal 720p (H.264) | 4-8 MB / 15s clip |
| Vertical 720p | 4-8 MB / 15s clip |
| Vertical 360p (low) | 1-2 MB / 15s clip |
| Thumbnail JPG | 50-100 KB |
| OG image PNG | 100-200 KB |
| **Total par kill** | **~12-20 MB** |

### Projections
- 400 kills = ~6 GB → **dans le free tier**
- 1 000 kills = ~15 GB → **depasse de 5 GB** → cout : 5 GB * $0.015 = **$0.075/mois**
- 2 000 kills = ~30 GB → cout : 20 * $0.015 = **$0.30/mois**
- 5 000 kills = ~75 GB → cout : 65 * $0.015 = **$0.975/mois**

**Verdict** : depasser le free tier R2 c'est vraiment rien cher (<€1/mois
meme a 5000 clips). L'egress gratuit illimite reste le gros avantage.

### Ou voir
https://dash.cloudflare.com → R2 → Overview → Usage tab

---

## 5. Vercel — frontend bandwidth

### Limites hobby
- **Bandwidth : 100 GB / mois**
- **Function invocations : 100 000 / mois**
- **Build minutes : 6 000 / mois**
- **Image Optimization : 1000 transformations / mois**

### Notre usage estime
Tant qu'on n'a pas 10 000+ users/jour, on est ultra large.

### Si on depasse
Vercel stoppe automatiquement le site au depassement (pas de facturation
surprise). On upgrade a Pro ($20/mois) si le site devient viral.

### Ou voir
https://vercel.com/sconnect1/kckills/usage

---

## 🎯 Routine recommandee

### Quotidien (30 sec, via Discord webhook)
Le worker envoie un rapport daily a 23:00 UTC dans le canal `#worker-logs` :
```
📊 KCKILLS Daily Report
Kills detected: 12
Kills clipped: 11
Kills analyzed: 11
Gemini quota used: 11/1000 (1.1%)
R2 storage: 2.3 GB / 10 GB
Supabase egress today: ~45 MB
Worker uptime: 23h 58m
```

### Hebdomadaire (5 min, le dimanche matin)
Bookmark et check :
1. https://aistudio.google.com/apikey (Gemini usage)
2. https://console.cloud.google.com/billing (Google Cloud budget)
3. https://supabase.com/dashboard/project/_/settings/usage (Supabase)
4. https://dash.cloudflare.com (R2 storage)
5. https://vercel.com/sconnect1/kckills/usage (Vercel bandwidth)

### Mensuel (10 min, le 1er du mois)
- Pg_dump de Supabase (backup manuel)
- Review des logs Sentry si configure
- Check du total spend sur les factures Google Cloud / Anthropic / Vercel

---

## 🚨 Red flags a surveiller

| Signal | Cause probable | Action |
|--------|----------------|--------|
| Gemini > 500 RPD en 1 journee | Worker boucle sur un clip | Tuer le worker, check les logs |
| Supabase egress > 4 GB / mois | Query inefficace / boucle | Verifier fn_get_feed_kills LIMIT |
| R2 Class A > 50K / jour | Upload en boucle | Rate limiter sur la phase de upload |
| Vercel bandwidth > 80 GB / mois | Viral spike | Upgrade a Pro ou throttle |
| Worker pas de heartbeat 1h+ | Daemon crashe | Restart systemd / Task Scheduler |

---

## 💰 Cout mensuel projete

### Phase 0 (pre-launch, ce qu'on a maintenant)
- Domaine : ~€1/mois (amorti sur €13/an pour .com)
- Toutes APIs : €0 (free tiers)
- **Total : ~€1/mois**

### Phase 1 (launch + 500 clips backfill)
- Domaine : €1
- Anthropic Haiku (moderation) : ~€4 (si active)
- Electricite PC worker : ~€5
- **Total : ~€10/mois**

### Phase 2 (viral, 10K MAU)
- Domaine : €1
- Anthropic Haiku : ~€8
- Electricite PC worker : ~€5
- R2 depassement (1000+ clips) : ~€0.30
- Vercel Pro (si on depasse) : €20 ← optionnel, seulement en cas de spike
- **Total : ~€14-34/mois**

### Phase 3 (legendaire, 50K+ MAU)
- Anthropic Haiku : ~€20
- R2 storage 75 GB : ~€1
- Vercel Pro : €20
- Supabase Pro : €25 (passage obligatoire)
- Sentry Team : €26 (optionnel)
- **Total : ~€80-100/mois** (toujours profitable si on a des sponsors / dons)

---

*Ce doc est a mettre a jour une fois par trimestre avec les vrais numeros observes.*
