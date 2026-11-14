import type { Messages } from '../messages';

export const standalone: Messages['standalone'] = {
  heading: 'Programredigerare',
  intro:
    'Körs helt i den här webbläsarfliken, utan någon enhet ansluten. Öppna ett program, redigera det och ladda sedan ner det eller skicka tillbaka det som en pull request.',
  repo: {
    title: 'Öppna från ett repo',
    hint: 'Förifyllt med projektets eget repo — tryck på Bläddra för att se dess program, eller peka fälten mot en annan klubbs.',
    owner: 'Ägare',
    ownerPlaceholder: 'ägare',
    repo: 'Repo',
    repoPlaceholder: 'repo',
    path: 'Sökväg',
    ref: 'Ref',
    refPlaceholder: 'gren, tagg eller commit — tomt för standardgrenen',
    browse: 'Bläddra bland program',
    loading: 'Laddar…',
    noFiles: 'Inga programfiler hittades på den sökvägen.',
    fileLabel: (id, title) => `${id} — ${title}`,
    declaredIdDiffers: (label, declaredId) => `${label} (dokumentet säger id ${declaredId})`,
  },
  github: {
    rateLimited: 'GitHubs API-gräns för oautentiserade anrop är nådd — försök igen om några minuter.',
    status: (status, url) => `GitHub svarade ${status} för ${url}.`,
    fetchStatus: (status, path) => `GitHub svarade ${status} vid hämtning av ${path}.`,
  },
  localFile: {
    title: 'Öppna en lokal fil',
    readFailed: 'Kunde inte läsa den filen.',
    origin: (name) => `lokal fil "${name}"`,
  },
  newDocument: {
    title: 'Börja på ett nytt program',
    button: 'Nytt program',
    origin: 'nytt program',
  },
  confirm: {
    invalidTitle: 'Det här är inte ett program som redigeraren kan öppna',
    back: 'Tillbaka',
    openTitle: (origin) => `Öppna ${origin}`,
    idLabel: 'Program-id',
    idHintBefore: 'Används som filnamn i en pull request — ',
    idHintBetween: '. Medföljande program har id under 1000 (uppladdade börjar där; se ',
    idHintAfter: ')',
    open: 'Öppna i redigeraren',
  },
};
