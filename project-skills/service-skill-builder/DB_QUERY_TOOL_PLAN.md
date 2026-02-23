# Database Query Tool Plan - ext-newsletters

**Created:** 2026-02-13
**Status:** PENDING
**Priority:** MEDIUM

## Purpose

Create a flexible CLI tool for ad-hoc database queries against the `articles` table, replacing/enhancing the limited `newsletter_stats.py` script.

## Problems with Current Scripts

| Script | Issue |
|--------|--------|
| `newsletter_stats.py` | Fixed queries, crashed with unpacking error, limited output |
| `check_duplicates.py` | Single-purpose, doesn't explore patterns |
| No combined tool | Need to run multiple scripts for related questions |

## Proposed Tool: `db_query.py`

A unified CLI tool supporting multiple query types with flexible arguments:

```bash
# Basic usage
python3 .claude/skills/ext-newsletters/scripts/db_query.py [QUERY_TYPE] [OPTIONS]

# Examples
db_query.py --senders --top 20
db_query.py --source-distribution
db_query.py --mismatched-sources
db_query.py --sender "Bloomberg" --by-date
db_query.py --date-range "2026-01-01:2026-02-01" --group-by source
db_query.py --export-csv output.csv --source financial-media
```

## Command Structure

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
| `--env PATH` | Custom .env file path | Project root .env |
| `--format {table,json,csv}` | Output format | table |
| `--output FILE` | Write to file instead of stdout | - |
| `--limit N` | Limit results | No limit |
| `--verbose` | Show SQL queries | False |

### Query Types

#### 1. Source Analysis

```bash
db_query.py --source-distribution
db_query.py --sources-by-count
db_query.py --mismatched-sources
```

| Output | Description |
|--------|-------------|
| source | Source tag value |
| count | Number of articles |
| percentage | % of total |
| first_date | Earliest article |
| last_date | Latest article |

**Use case:** Quick overview of source tag health

#### 2. Sender Analysis

```bash
db_query.py --senders [--top N] [--source SOURCE]
db_query.py --sender "NAME" [--detail]
```

| Output | Description |
|--------|-------------|
| sender_name | Newsletter sender |
| source | Assigned source tag |
| count | Total articles |
| last_article | Date of most recent |
| avg_per_week | Weekly frequency |

**Use case:** Identify which senders need source reclassification

#### 3. Duplicate Detection

```bash
db_query.py --duplicates [--show-samples]
db_query.py --duplicate-stats [--by-sender]
```

| Output | Description |
|--------|-------------|
| total_duplicates | Number of duplicate hashes |
| unique_articles | Non-duplicate count |
| dup_rate | Percentage duplicated |
| worst_senders | Top 10 senders by duplicates |

**Use case:** Monitor data quality, identify problematic newsletters

#### 4. Date Range Queries

```bash
db_query.py --by-date [--days N] [--range START:END]
db_query.py --monthly-summary
db_query.py --streaks
```

| Output | Description |
|--------|-------------|
| date | Day/month |
| articles | Count |
| new | New articles (non-duplicates) |
| senders | Number of unique senders |

**Use case:** Import activity monitoring, trend analysis

#### 5. URL Analysis

```bash
db_query.py --urls --domain-summary
db_query.py --url-patterns [--top N]
```

| Output | Description |
|--------|-------------|
| domain | Extracted domain |
| count | Articles from this domain |
| source | Associated source tag |
| mislabeled | Flag if source mismatches domain |

**Use case:** Identify Substack vs financial media by URL patterns

#### 6. Missing/Metadata Issues

```bash
db_query.py --missing-titles
db_query.py --orphaned-records
db_query.py --data-quality
```

| Output | Description |
|--------|-------------|
| issue_type | Category of problem |
| count | Number affected |
| sample_ids | Example article IDs |

**Use case:** Data integrity checks

## Implementation Structure

```python
#!/usr/bin/env python3
"""Flexible database query tool for ext-newsletters articles table"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Environment setup
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

# Add project root
project_root = Path(__file__).resolve().parents[4]
sys.path.append(str(project_root))
load_dotenv(project_root / ".env")

from shared.db_pool_manager import get_db_cursor


class DatabaseQuerier:
    """Flexible article database queries with multiple output formats."""

    QUERY_TEMPLATES = {
        "source-distribution": """
            SELECT source, COUNT(*) as count,
                   ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM articles), 2) as percentage,
                   MIN(published_at) as first_date,
                   MAX(published_at) as last_date
            FROM articles
            GROUP BY source
            ORDER BY count DESC
        """,
        "senders": """
            SELECT sender_name, source, COUNT(*) as count,
                   MAX(published_at) as last_article
            FROM articles
            WHERE sender_name IS NOT NULL
            GROUP BY sender_name, source
            ORDER BY count DESC
            LIMIT %(limit)s
        """,
        # ... more templates
    }

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.results = []

    def execute(self) -> None:
        """Run the specified query."""
        query = self.QUERY_TEMPLATES.get(self.args.query_type)
        if not query:
            raise ValueError(f"Unknown query type: {self.args.query_type}")

        with get_db_cursor(RealDictCursor) as cursor:
            cursor.execute(query, vars(self.args))
            self.results = cursor.fetchall()

    def format_output(self) -> str:
        """Format results based on --format option."""
        if self.args.format == "json":
            return json.dumps(self.results, indent=2, default=str)
        elif self.args.format == "csv":
            return self._format_csv()
        else:
            return self._format_table()

    # ... formatting methods


def main():
    parser = argparse.ArgumentParser(
        description="Query ext-newsletters article database",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --source-distribution
  %(prog)s --senders --top 20 --source financial-media
  %(prog)s --mismatched-sources --export-csv issues.csv
        """
    )

    # Query type selection
    parser.add_argument(
        "query_type",
        choices=["source-distribution", "senders", "duplicates", "by-date"],
        help="Type of query to run"
    )

    # Common filters
    parser.add_argument("--source", help="Filter by source tag")
    parser.add_argument("--sender", help="Filter by sender name")
    parser.add_argument("--limit", type=int, default=100, help="Limit results")
    parser.add_argument("--days", type=int, help="Last N days")

    # Output control
    parser.add_argument("--format", choices=["table", "json", "csv"], default="table")
    parser.add_argument("--output", help="Write to file")
    parser.add_argument("--verbose", action="store_true")

    args = parser.parse_args()
    querier = DatabaseQuerier(args)
    querier.execute()

    output = querier.format_output()
    if args.output:
        Path(args.output).write_text(output)
        print(f"Written to {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
```

## Output Formats

### Table Format (Default)

```
┌────────────────────────────────┬─────────┬────────────┬────────────────────┐
│ Sender Name                  │ Source  │ Count      │ Last Article         │
├────────────────────────────────┼─────────┼────────────┼────────────────────┤
│ Bloomberg                    │ gmail-… │      119   │ 2026-02-12          │
│ Reuters Daily Briefing       │ Substack│      108   │ 2026-02-11          │
└────────────────────────────────┴─────────┴────────────┴────────────────────┘
```

### JSON Format (API/Machine-readable)

```json
{
  "query": "senders",
  "timestamp": "2026-02-13T01:00:00Z",
  "results": [
    {"sender_name": "Bloomberg", "source": "gmail-substack", "count": 119}
  ]
}
```

### CSV Format (Spreadsheet export)

```csv
sender_name,source,count,last_article
Bloomberg,gmail-substack,119,2026-02-12
Reuters Daily Briefing,Substack,108,2026-02-11
```

## Phase 1: Core Implementation

**MVP Features:**
- [ ] Basic argparse structure with query type selection
- [ ] `source-distribution` query
- [ ] `senders` query with `--top` and `--source` filters
- [ ] Table and JSON output formats
- [ ] Basic error handling (connection failures, empty results)

**Estimated effort:** ~2 hours

## Phase 2: Enhanced Queries

**Additional query types:**
- [ ] `duplicates` - based on existing `check_duplicates.py` logic
- [ ] `by-date` - date range aggregation
- [ ] `mismatched-sources` - sender vs source tag conflicts
- [ ] `url-analysis` - domain extraction and pattern detection

**Estimated effort:** ~3 hours

## Phase 3: Output Polish

**Enhanced output:**
- [ ] CSV export with proper quoting
- [ ] Colorized terminal output (optional `--color` flag)
- [ ] Progress bars for long queries
- [ ] Query execution time display
- [ ] Pretty numbers (1,234 instead of 1234)

**Estimated effort:** ~1 hour

## Phase 4: Reusability

**Template for other services:**
- [ ] Extract base class `ServiceDatabaseQuerier`
- [ ] Document query template format for ext-multi-source, ext-squawk-summarizer
- [ ] Create `db_query.py` template in service-skill-builder

**Estimated effort:** ~1 hour

## Integration with Existing Scripts

| Decision | Rationale |
|----------|-----------|
| **Keep** `health_check.py` | Critical for monitoring, does one thing well |
| **Keep** `validate_config.py` | Separate concern (OAuth/labels) |
| **Enhance** `check_duplicates.py` | Can become wrapper: `db_query.py --duplicates` |
| **Deprecate** `newsletter_stats.py` | Replace with `db_query.py` multiple calls |

## Query Templates Catalog

### Reference Implementation

```sql
-- Source distribution with percentages
SELECT source,
       COUNT(*) as count,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM articles
GROUP BY source
ORDER BY count DESC;

-- Top senders by source
SELECT sender_name,
       source,
       COUNT(*) as count,
       MAX(published_at) as last_article
FROM articles
WHERE sender_name IS NOT NULL
  AND source = %(source)s  -- Optional filter
GROUP BY sender_name, source
ORDER BY count DESC
LIMIT %(limit)s;

-- Sender-source mismatches (heuristic)
SELECT sender_name,
       source,
       COUNT(*) as count,
       STRING_AGG(url, ', ' ORDER BY created_at DESC LIMIT 5) as sample_urls
FROM articles
WHERE (
    -- Sender suggests financial but source says substack
    (LOWER(sender_name) LIKE ANY(ARRAY['%bloomber%', '%reuters%', '%cnbc%'])
     AND source NOT IN ('financial-media', 'gmail-substack'))
    OR
    -- URL suggests substack but source is wrong
    (url LIKE '%substack.com%' AND source != 'gmail-substack')
)
GROUP BY sender_name, source
ORDER BY count DESC;

-- Duplicate statistics
SELECT
    COUNT(DISTINCT content_hash) as unique_articles,
    COUNT(*) as total_articles,
    COUNT(*) - COUNT(DISTINCT content_hash) as duplicates,
    ROUND((COUNT(*) - COUNT(DISTINCT content_hash)) * 100.0 / COUNT(*), 2) as dup_percent
FROM articles;

-- Recent import activity
SELECT DATE_TRUNC('day', published_at) as date,
       COUNT(*) as articles,
       COUNT(DISTINCT sender_name) as senders
FROM articles
WHERE published_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', published_at)
ORDER BY date DESC;

-- Data quality check
SELECT
    COUNT(CASE WHEN title IS NULL OR title = '' THEN 1 END) as missing_titles,
    COUNT(CASE WHEN url IS NULL OR url = '' THEN 1 END) as missing_urls,
    COUNT(CASE WHEN sender_name IS NULL OR sender_name = '' THEN 1 END) as missing_senders,
    COUNT(CASE WHEN published_at IS NULL THEN 1 END) as missing_dates,
    COUNT(*) as total_articles
FROM articles;
```

## Success Criteria

- [ ] All current `newsletter_stats.py` queries reproducible via new tool
- [ ] Command-line interface is intuitive (help text clear)
- [ ] Output formats are useful for both human and machine consumption
- [ ] Tool is extensible to other services (ext-multi-source, etc.)
- [ ] Performance acceptable for ~5000 article table

## Future Enhancements

| Feature | Description | Priority |
|----------|-------------|----------|
| `--live` flag | Watch mode for real-time updates | Low |
| Graph output | ASCII bar charts for trends | Medium |
| Multi-table queries | Join with other tables if added | Low |
| Export to HTML | Formatted HTML report | Low |

## Notes

- Tool should handle both direct and PgBouncer connections (via `db_host_resolver`)
- All SQL should use parameterized queries (no string formatting)
- Consider adding `--dry-run` flag to show SQL without executing
- Error messages should be actionable (not just "database error")
