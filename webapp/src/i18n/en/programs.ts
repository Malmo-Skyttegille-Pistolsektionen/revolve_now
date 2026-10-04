export const programs = {
  title: 'Programs',
  upload: 'Upload program…',
  newProgram: 'New program',
  viewOnly: 'View only — log in to manage programs',
  loading: 'Loading programs…',
  listFailed: (detail: string) => `Could not list programs: ${detail}`,
  empty: 'The device holds no programs.',
  columns: {
    id: 'ID',
    title: 'Title',
    description: 'Description',
    source: 'Source',
    actions: 'Actions',
  },
  // The per-cell labels a phone shows once the table restacks as blocks.
  rowLabels: {
    id: 'ID',
    title: 'Title',
    about: 'About',
    source: 'Source',
    actions: 'Actions',
  },
  badges: {
    loaded: 'Loaded',
    shipped: 'Shipped',
    uploaded: 'Uploaded',
  },
  unrunnable: (needs: string, has: string) =>
    `Needs banks ${needs}; this device has ${has}. It stays in the library and runs on a device that has them.`,
  actions: {
    download: 'Download',
    downloading: 'Downloading…',
    load: 'Load',
    unload: 'Unload',
    edit: 'Edit…',
    editCopy: 'Edit a copy…',
    replace: 'Replace…',
    delete: 'Delete',
  },
  success: {
    loaded: (title: string) => `Loaded "${title}" on the device.`,
    unloaded: 'Nothing is loaded on the device now.',
    deleted: (title: string) => `Deleted "${title}".`,
    uploaded: (title: string, id: number) => `Uploaded "${title}" as program ${id}.`,
    replaced: (id: number, title: string) => `Replaced program ${id} with "${title}".`,
    saved: (title: string, id: number) => `Saved "${title}" as program ${id}.`,
  },
  failure: {
    load: (title: string) => `Could not load "${title}".`,
    delete: (title: string) => `Could not delete "${title}".`,
    upload: (title: string) => `Could not upload "${title}".`,
    download: (title: string) => `Could not download "${title}" from the device.`,
    notAProgram: (fileName: string) => `"${fileName}" is not a program the device will accept.`,
    idMismatch: (fileName: string, declaredId: number, targetId: number, targetTitle: string) =>
      `"${fileName}" declares id ${declaredId}, but it was picked to replace program ${targetId} ` +
      `("${targetTitle}"). The device does not renumber a program, so this is either the wrong file or the ` +
      'wrong row.',
    uploadAsNew: 'Upload as a new program instead',
  },
  uploadDialog: {
    title: 'The device will not store this file as written',
    replaceIntro: (id: number, fileName: string) =>
      `Replacing program ${id} with "${fileName}" cannot be undone. It will be stored as:`,
    createIntro: (fileName: string) => `"${fileName}" will be stored as:`,
    replaceAnyway: 'Replace anyway',
    uploadAnyway: 'Upload anyway',
  },
  deleteDialog: {
    title: (title: string) => `Delete "${title}"?`,
    loadedBody: 'This is the program currently loaded on the device. Deleting it unloads it first.',
    body: 'The program file is removed from the device. This cannot be undone.',
    confirm: 'Delete',
  },
  // What `lib/program-notices.ts` says when a call to the device is refused.
  notices: {
    lockedNotSignedIn: 'The controls are locked and this browser is not signed in — sign in under Settings.',
    readonly: (id: number) =>
      `Program ${id} is shipped with the firmware and cannot be replaced. Upload the file as a new program instead.`,
    loaded: (id: number) =>
      `Program ${id} is the one currently loaded on the device, and a loaded program cannot be replaced — ` +
      'the run position points into it. Unload it first — the Unload button on the program’s row, or on the ' +
      'Run page — and then replace it. If a series is running, stop it before unloading.',
    gone: (id: number) => `Program ${id} is no longer on the device.`,
    replaceFailed: (id: number) => `Could not replace program ${id}.`,
    deletedWhileOpen: (id: number) =>
      `Program ${id} is no longer on the device — it was deleted while you had it open. Nothing typed here ` +
      `was lost, but it cannot go back under id ${id}: the device refuses a replace of a program it does not ` +
      'have. Save now creates this document as a new program, under an id the device assigns.',
    reloadFailed: (id: number, detail: string) =>
      `Could not re-read program ${id} from the device: ${detail} ` +
      `What is on screen is what was loaded, plus your edits; Save still replaces program ${id}.`,
    unloadWhileRunning:
      'The device is running a program, and unloading would end the series. Pause the run first, then ' +
      'unload — Pause sits beside Unload on the Run page.',
    unloadFailed: 'Could not unload the program.',
  },
};
