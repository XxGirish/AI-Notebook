import { useCallback, useEffect, useState } from "react";
import type { AiFeedbackRecord } from "../domain/aiFeedback";
import { addAiFeedback, loadAiFeedback } from "../persistence/notebookDatabase";

/** Reports on one page's AI content. A report is shown only once it is stored. */
export function useAiFeedback(pageId: string) {
  const [reports, setReports] = useState<AiFeedbackRecord[]>([]);

  useEffect(() => {
    let live = true;
    setReports([]);
    loadAiFeedback(pageId).then(
      (stored) => {
        if (live) setReports((current) => [...stored, ...current.filter((report) => !stored.some((entry) => entry.id === report.id))]);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [pageId]);

  const addReport = useCallback(async (report: AiFeedbackRecord) => {
    await addAiFeedback(report);
    setReports((current) => [...current, report]);
  }, []);

  return { reports, addReport };
}
