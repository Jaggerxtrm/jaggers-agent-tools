# 🧠 Service Skill Builder: Sistema di Automazione dell'Intelligenza Operativa

Il **Service Skill Builder** è un framework avanzato di "Meta-Documentazione" progettato per il progetto Darth Feedor. Il suo scopo è generare, mantenere e validare dinamicamente le conoscenze specialistiche (Skills) necessarie agli agenti AI per operare sull'infrastruttura a microservizi.

Questo sistema trasforma l'infrastruttura Docker e il codice sorgente in un ecosistema di "esperti digitali" sempre aggiornati.

## 🏗️ Architettura del Sistema

Il sistema si basa su tre pilastri fondamentali:

### 1. Il Generatore (`generate_service_skill.py`)
Il motore di analisi che crea le Skill. Utilizza un approccio a più livelli:
- **Analisi Statica**: Scansiona i file `docker-compose.yml` per mappare container e variabili d'ambiente.
- **Integrazione SSOT**: Estrae l'intento architettonico dalle memorie "Single Source of Truth".
- **Semantic Exploration**: Identifica pattern SQL, chiavi Redis e dipendenze esterne direttamente dal codice.

### 2. Il Validatore (`skill_health_check.py`)
Un sistema di monitoraggio continuo che rileva il "drift" (disallineamento) tra il codice e la documentazione.
- **Nuova Funzionalità Schema-Aware**: Il validatore monitora ora la freschezza degli schema database. Se il sommario dello schema è più vecchio di un'ora o del codice sorgente, la skill viene marcata come **STALE**.
- **Risoluzione Alias**: Gestisce correttamente la mappatura tra nomi dei servizi Docker (es. `postgres-dev`) e nomi dei logical stack (es. `postgres-stack`).

### 3. Logica di Raggruppamento (Stack-Aware)
Consolida servizi correlati (es. `redis-master`, `sentinel`) in gruppi logici coerenti (es. `redis-stack`), fornendo una visione architettonica d'insieme.

---

## 🛠️ Strumenti Specialistici (Novità)

Con l'evoluzione della "Fase Expert", il sistema ha introdotto strumenti standardizzati per la manutenzione profonda:

*   **`map_schema.py`**: Script per il `postgres-stack` che interroga `information_schema` per generare report dettagliati (JSON/Markdown) della struttura del database (tabelle, colonne, indici, FK).
*   **`db_query.py` Avanzato**: Tool CLI con query operative predefinite per monitorare:
    - Connessioni attive e stato dei pool (`active-conns`, `pool-stats`).
    - Statistiche di ingestione (`squawk-stats`, `article-stats`).
    - Elaborazione AI (`research-stats`, `pending-articles`).
*   **Health Checks Multi-Livello**: Gli script di salute ora verificano non solo lo stato dei container Docker, ma anche la connettività effettiva dei servizi (es. query di versione SQL o endpoint `/health` FastAPI).

---

## 🛡️ Guardrail e Metodologia "Script-First"

Il sistema è progettato per garantire sicurezza, auditabilità e rispetto delle raffinazioni manuali:

*   **Database Helper (`db_helper.py`)**: Fornisce un'astrazione sicura per la connessione, integrando la logica di **fallback automatico** (es. da PgBouncer a Postgres diretto).
*   **Encapsulation**: Gli agenti esperti **non eseguono mai SQL diretto** nel terminale. Ogni operazione ricorrente viene incapsulata in uno script validato.
*   **Regioni Protette (SEMANTIC_START/END)**: I marker nel file `SKILL.md` proteggono le analisi architettoniche (es. logica di rotazione credenziali Qwen o meccanismi di Skip-on-Failure) durante gli aggiornamenti automatici.

---

## 🚀 Comandi Rapidi

```bash
# Esegue il check di salute e drift su tutte le skill
python3 scripts/skill_health_check.py

# Aggiorna lo schema del database nel postgres-stack
python3 .claude/skills/postgres-stack/scripts/map_schema.py

# Genera o aggiorna una skill esistente preservando le zone protette
python3 generate_service_skill.py <service-name> --update

# Sincronizza le migliorie tra i diversi modelli AI
python3 scripts/sync_llm_skills.py
```

---

## 🧠 Evoluzione della Fase Expert (Esempi)
Le skill non sono solo documentazione, ma manuali operativi che contengono logiche scoperte durante l'analisi:
- **Qwen Sync-Back**: Preservazione dei token OAuth aggiornati durante la rotazione.
- **Summarizer Resilience**: Gestione automatica dei filtri di sicurezza tramite `processing_failures`.
- **Vector Strategy**: Documentazione differenziata per embedding a 384d (News) e 1536d (Research).
