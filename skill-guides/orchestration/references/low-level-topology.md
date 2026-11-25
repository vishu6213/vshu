# Low-level topology

```text
VSHU terminal create --worktree active --title <task_name> --command "<agent_command>" --json
VSHU terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
VSHU orchestration dispatch --task <task_id> --to <handle> --inject
```

To give a Task to a terminal or chat Vshu did not start:

```text
VSHU orchestration worker-start --task <task_id> --terminal <handle> --json
```
