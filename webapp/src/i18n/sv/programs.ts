import type { Messages } from '../messages';

export const programs: Messages['programs'] = {
  title: 'Program',
  upload: 'Ladda upp program…',
  newProgram: 'Nytt program',
  viewOnly: 'Endast visning — logga in för att hantera program',
  loading: 'Hämtar program…',
  listFailed: (detail) => `Kunde inte lista programmen: ${detail}`,
  empty: 'Enheten har inga program.',
  columns: {
    id: 'ID',
    title: 'Titel',
    description: 'Beskrivning',
    source: 'Källa',
    actions: 'Åtgärder',
  },
  rowLabels: {
    id: 'ID',
    title: 'Titel',
    about: 'Om',
    source: 'Källa',
    actions: 'Åtgärder',
  },
  badges: {
    loaded: 'Laddat',
    shipped: 'Medföljande',
    uploaded: 'Uppladdat',
  },
  unrunnable: (needs, has) =>
    `Kräver tavelgrupperna ${needs}; den här enheten har ${has}. Programmet ligger kvar i biblioteket och går att köra på en enhet som har dem.`,
  actions: {
    download: 'Ladda ner',
    downloading: 'Laddar ner…',
    load: 'Ladda',
    unload: 'Avlasta',
    edit: 'Redigera…',
    editCopy: 'Redigera en kopia…',
    replace: 'Ersätt…',
    delete: 'Ta bort',
  },
  success: {
    loaded: (title) => `Laddade "${title}" på enheten.`,
    unloaded: 'Inget program är laddat på enheten nu.',
    deleted: (title) => `Tog bort "${title}".`,
    uploaded: (title, id) => `Laddade upp "${title}" som program ${id}.`,
    replaced: (id, title) => `Ersatte program ${id} med "${title}".`,
    saved: (title, id) => `Sparade "${title}" som program ${id}.`,
  },
  failure: {
    load: (title) => `Kunde inte ladda "${title}".`,
    delete: (title) => `Kunde inte ta bort "${title}".`,
    upload: (title) => `Kunde inte ladda upp "${title}".`,
    download: (title) => `Kunde inte ladda ner "${title}" från enheten.`,
    notAProgram: (fileName) => `"${fileName}" är inte ett program som enheten godtar.`,
    idMismatch: (fileName, declaredId, targetId, targetTitle) =>
      `"${fileName}" anger id ${declaredId}, men valdes för att ersätta program ${targetId} ("${targetTitle}"). ` +
      'Enheten numrerar inte om program, så antingen är det fel fil eller fel rad.',
    uploadAsNew: 'Ladda upp som nytt program i stället',
  },
  uploadDialog: {
    title: 'Enheten sparar inte filen som den är skriven',
    replaceIntro: (id, fileName) => `Att ersätta program ${id} med "${fileName}" går inte att ångra. Det sparas som:`,
    createIntro: (fileName) => `"${fileName}" sparas som:`,
    replaceAnyway: 'Ersätt ändå',
    uploadAnyway: 'Ladda upp ändå',
  },
  deleteDialog: {
    title: (title) => `Ta bort "${title}"?`,
    loadedBody: 'Det här är programmet som är laddat på enheten just nu. Tar du bort det avlastas det först.',
    body: 'Programfilen tas bort från enheten. Det går inte att ångra.',
    confirm: 'Ta bort',
  },
  notices: {
    lockedNotSignedIn: 'Kontrollerna är låsta och den här webbläsaren är inte inloggad — logga in under Inställningar.',
    readonly: (id) =>
      `Program ${id} följer med firmware och kan inte ersättas. Ladda upp filen som ett nytt program i stället.`,
    loaded: (id) =>
      `Program ${id} är det som är laddat på enheten just nu, och ett laddat program kan inte ersättas — ` +
      'körningens position pekar in i det. Avlasta det först — knappen Avlasta på programmets rad eller på ' +
      'sidan Kör — och ersätt det sedan. Om en serie körs, stoppa den innan du avlastar.',
    gone: (id) => `Program ${id} finns inte längre på enheten.`,
    replaceFailed: (id) => `Kunde inte ersätta program ${id}.`,
    deletedWhileOpen: (id) =>
      `Program ${id} finns inte längre på enheten — det togs bort medan du hade det öppet. Inget du har skrivit ` +
      `här har gått förlorat, men det kan inte läggas tillbaka under id ${id}: enheten vägrar ersätta ett program ` +
      'den inte har. Spara skapar nu dokumentet som ett nytt program, under ett id som enheten tilldelar.',
    reloadFailed: (id, detail) =>
      `Kunde inte läsa om program ${id} från enheten: ${detail} ` +
      `Det som visas är det som laddades, plus dina ändringar; Spara ersätter fortfarande program ${id}.`,
    unloadWhileRunning:
      'Enheten kör ett program, och att avlasta skulle avsluta serien. Pausa körningen först och avlasta ' +
      'sedan — Pausa sitter bredvid Avlasta på sidan Kör.',
    unloadFailed: 'Kunde inte avlasta programmet.',
  },
};
