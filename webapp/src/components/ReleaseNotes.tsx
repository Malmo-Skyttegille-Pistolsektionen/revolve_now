import Markdown from 'react-markdown';
import styles from './ReleaseNotes.module.css';

/**
 * A release's notes, as GitHub would show them. The body is written by
 * whoever cuts a release, so it is rendered without raw HTML (react-markdown's
 * default), without images, and with only https links, which open elsewhere.
 */
export function ReleaseNotes({ source }: { source: string }): React.ReactNode {
  return (
    <div className={styles.notes} data-testid='release-notes'>
      <Markdown
        disallowedElements={['img']}
        unwrapDisallowed
        components={{
          a: ({ href, children }) =>
            href?.startsWith('https://') ? (
              <a href={href} target='_blank' rel='noopener noreferrer'>
                {children}
              </a>
            ) : (
              <>{children}</>
            ),
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
