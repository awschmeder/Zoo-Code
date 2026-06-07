---
"zoo-code": patch
---

fix(terminal): kill entire process group on Stop so child commands (e.g. `sleep 30`) are not orphaned and allowed to continue running after user clicked 'Stop'.
