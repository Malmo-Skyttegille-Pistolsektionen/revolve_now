import { useQuery } from '@tanstack/react-query';
import { useProgramsApi } from '../api/programs';
import { useT, type Messages } from '../i18n';
import { downloadJson, programFilename } from '../lib/download';
import { programTotalMs } from '../lib/program-document';
import { Timeline } from './Timeline';
import styles from './ProgramDetails.module.css';

type ProgramDetailsProps = {
  id: number;
  onClose: () => void;
};

function formatDuration(t: Messages['run']['programDetails'], totalMs: number): string {
  const seconds = Math.round(totalMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? t.minutes(minutes, seconds % 60) : t.seconds(seconds);
}

/**
 * The full document behind one row: what the list omits (`GET /programs`
 * returns summaries) plus the same timeline the run view draws, with no
 * playhead because nothing is running here.
 */
export function ProgramDetails({ id, onClose }: ProgramDetailsProps): React.ReactNode {
  const programsApi = useProgramsApi();
  const t = useT().run.programDetails;

  const {
    data: program,
    isPending,
    error,
  } = useQuery({
    queryKey: ['program', id],
    queryFn: () => programsApi.get(id),
    staleTime: Infinity,
  });

  function handleDownload(): void {
    if (!program) return;

    downloadJson(programFilename(program.id), JSON.stringify(program, null, 2));
  }

  return (
    <section className={styles.panel} data-testid='program-details'>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{program?.title ?? t.title(id)}</h2>
          {program && <p className={styles.description}>{program.description}</p>}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.button} onClick={handleDownload} disabled={!program}>
            {t.downloadJson}
          </button>
          <button className={styles.button} onClick={onClose}>
            {t.close}
          </button>
        </div>
      </header>

      {isPending && <p className={styles.message}>{t.loading}</p>}
      {error && <p className={styles.message}>{t.couldNotLoad(error.message)}</p>}

      {program && (
        <>
          <p className={styles.meta} data-testid='program-details-meta'>
            {t.meta(
              program.series.length,
              program.series.reduce((count, series) => count + series.events.length, 0),
              formatDuration(t, programTotalMs(program)),
            )}
          </p>
          <Timeline program={program} currentSeriesIndex={null} currentEventIndex={null} tickerMs={null} />
        </>
      )}
    </section>
  );
}
