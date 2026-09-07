# Experiment evidence


This skill is a transport evaluation. When native coordination misbehaves, preserve a short durable note on the owning work item or operator log:

```text
transport: pi-intercom | claude-native | pi-claude-link
sender/target: <stable names/ids>
operation: send | ask | reply | idle-notice
observed: delivered | held | refused | timeout | disconnected | ambiguous | duplicate | wrong-correlation
recovery: <what was required>
terminal fallback used: yes/no + why
```

The experiment succeeds only if native messaging materially reduces:

- forgotten replies;
- lost wakeups;
- unsafe sends into working agents;
- manual polling;
- pane-identity coupling;
- duplicate sends after uncertain outcomes;
- operator intervention required just to continue a conversation.

If the experiment exposes correlation/durability gaps, fix or replace the adapter rather than recreating xtmux's semantic message store inside this skill.
