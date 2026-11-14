import type { DocumentIssue } from '../lib/program-document';

/** A program document's issues, one per line: where in the document, then what is wrong. */
export function IssueList({
  issues,
  testId,
  className,
}: {
  issues: DocumentIssue[];
  testId?: string;
  className?: string;
}): React.ReactNode {
  return (
    <ul data-testid={testId} className={className}>
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>
          <code>{issue.path || '/'}</code> — {issue.message}
        </li>
      ))}
    </ul>
  );
}
