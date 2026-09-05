# Project provenance and clean origin

Gozne has a new repository and independent history. Earlier private prototypes
informed behavior; the initial implementation was written for Gozne. Private
source references and operational evidence remain outside this public
repository.

## Incorporating material

- Check ownership and licensing before reusing third-party code.
- Keep private repositories, histories and configurations out of public commits.
- Use `.test` domains, synthetic identities and ephemeral keys in tests.
- Never include real wallets, private keys, cookies, sessions, logs or personal
  data from another system.
- Review dependencies, published files and Docker build context.

The browser panel is an original HTML/CSS/JavaScript implementation. Tabler was
reviewed as a dashboard layout reference; its source code and assets were not
copied or vendored.

## Checks

CI runs Gitleaks on files and history and audits dependencies. Docker copies an
explicit set of build inputs. Local state, backups, reports, installed packages
and compiled output are excluded from Git.

Manual review of staged changes, examples and documentation remains necessary. A
scanner alone cannot prove the absence of private information. The public
repository has no selected distribution license yet.
