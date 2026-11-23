// Targets from the support lead's meeting notes, in WORKING minutes.
// One working day = 9:30–18:30 = 540 minutes.
export const WORKING_DAY_MIN = 540;

export const SLA_TARGETS = {
  // "cannot work at all": reply in 2 hours, fix the same working day (= one working day)
  urgent: { responseMin: 120, resolveMin: WORKING_DAY_MIN },
  // "reply within half a day, fix in about three days"
  medium: { responseMin: WORKING_DAY_MIN / 2, resolveMin: 3 * WORKING_DAY_MIN },
  // "reply within one day, finish in about one week" (one working week)
  low: { responseMin: WORKING_DAY_MIN, resolveMin: 5 * WORKING_DAY_MIN },
};

// "If a customer does not reply for about one working week, we close the ticket."
export const AUTO_CLOSE_AFTER_MIN = 5 * WORKING_DAY_MIN;

// "They should be able to open it again, but only for about one week." (calendar days)
export const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// When priority changes on a running timer, the new deadline is measured from
// creation (time already used is kept) but is never earlier than the change
// time plus this grace. Escalating honestly should not create an instant breach;
// if nobody acts within the grace, the ticket is late.
export const PRIORITY_CHANGE_GRACE_MIN = 30;
