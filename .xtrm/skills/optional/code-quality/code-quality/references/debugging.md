# Systematic debugging

1. Reproduce or precisely characterize the symptom.
2. Gather the smallest evidence that narrows the failure path.
3. Form a falsifiable hypothesis.
4. Test the hypothesis before editing.
5. Fix the root cause with the smallest correct change.
6. Add/adjust a test that fails for the pre-fix defect when practical.
7. Re-run the real failing path plus relevant regression checks.

Do not stack speculative fixes. When evidence contradicts the hypothesis, discard it.