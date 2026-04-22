# ORCHESTRATOR

- execution_mode: sequential
- participants:
  - implementation
  - validation
- handoff:
  - implementation -> validation
  - validation -> user_feedback
- stop_conditions:
  - request for backend storage
  - dependency change beyond Konva
  - failed browser load

## Notes
- Keep the first version static and easy to open.
- Maintain the data schema as `{ nodes: [], edges: [], groups: [] }`.
- Prefer explicit command parsing hooks so real NLP can replace regex later.
