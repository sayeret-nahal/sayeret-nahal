"use client";

import { buttonClass } from "@/components/ui";

/** Full export contains sensitive data — say so before downloading. */
export function ExportAllLink() {
  return (
    <a
      href="/api/export"
      className={buttonClass("secondary", "sm")}
      onClick={(e) => {
        if (!window.confirm("הקובץ יכלול את כל המידע של העמותה, כולל מידע רגיש על פצועים ומשפחות שכולות.\nשמרו אותו רק במחשב מוגן, אל תשלחו אותו בדוא״ל, ומחקו אותו בסיום. הייצוא נרשם ביומן הפעולות.\n\nלהמשיך?")) e.preventDefault();
      }}
    >
      ייצוא כל הנתונים לאקסל
    </a>
  );
}
