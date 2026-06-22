# archive/

Schema **superati**, tenuti solo per storico. NON applicarli.

- `schema.sql`, `schema_v2.sql`, `schema_v3.sql` — versioni evolutive ereditate da Freedom Performance OS durante la replica iniziale.

La fonte di verità attuale del DB è in root:
- `schema_sts.sql` — base (profiles, RLS, os_entries, os_targets, kpi_catalog + seed reparti STS).
- `schema_marketing.sql` — Piano Marketing mensile (`marketing_months`).
