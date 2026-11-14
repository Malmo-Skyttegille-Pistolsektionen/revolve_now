import type { Messages } from '../messages';
import { decimal } from './format';

function seconds(value: number): string {
  return `${decimal(value.toFixed(1))} s`;
}

export const audios: Messages['audios'] = {
  title: 'Ljud',
  dismiss: 'Stäng',
  feedback: {
    playing: (title) => `Spelar upp "${title}" på enheten.`,
    playFailed: (title, detail) => `Kunde inte spela upp "${title}": ${detail}`,
    deleted: (title) => `Tog bort "${title}".`,
    deleteFailed: (title, detail) => `Kunde inte ta bort "${title}": ${detail}`,
    uploaded: (title, id) => `Laddade upp "${title}" som klipp ${id}.`,
    uploadFailed: (detail) => `Uppladdningen misslyckades: ${detail}`,
    converting: (name) => `Konverterar "${name}"…`,
    alreadyDeviceFormat: (name) => `"${name}" är redan i enhetens format och skickas som den är.`,
    converted: (name, length, bytes) => `Konverterade "${name}": ${seconds(length)}, ${bytes} byte.`,
    sentUnconverted: (name) =>
      `Den här webbläsaren kunde inte konvertera "${name}", så den skickas som den är och enheten får kontrollera den.`,
  },
  upload: {
    title: 'Ladda upp ett klipp',
    file: 'Ljudfil',
    clipTitle: 'Titel',
    clipTitlePlaceholder: 'Titel',
    submit: 'Ladda upp',
    converting: 'Konverterar…',
    uploading: 'Laddar upp…',
    hint: (maxSeconds) =>
      `WAV, M4A, MP3 eller något annat som den här webbläsaren kan spela. Filen konverteras här till enhetens komprimerade format innan den laddas upp, upp till ${maxSeconds} s.`,
    viewOnly: 'Endast visning — logga in för att spela upp, ladda upp eller ta bort',
  },
  library: {
    title: 'Ljudbibliotek',
    loading: 'Laddar klipp…',
    loadFailed: (detail) => `Kunde inte läsa in klippen: ${detail}`,
    empty: 'Inga klipp på enheten.',
    columns: {
      id: 'ID',
      title: 'Titel',
      source: 'Källa',
      file: 'Fil',
      actions: 'Åtgärder',
    },
    shipped: 'Medföljande',
    uploaded: 'Uppladdat',
    play: 'Spela upp',
    delete: 'Ta bort',
    cancel: 'Avbryt',
    confirm: 'Bekräfta',
  },
  rejection: {
    notWav: (name) => `"${name}" heter inte .wav, och enheten tar inte emot något annat.`,
    tooBig: (name, bytes, maxBytes) => `"${name}" är ${bytes} byte. Enheten tar emot högst ${maxBytes} byte per klipp.`,
  },
  convert: {
    tooLong: (name, length, maxLength) =>
      `"${name}" är ${seconds(length)} lång. Ett konverterat klipp får vara högst ${seconds(maxLength)}.`,
    tooBig: (name, bytes, maxBytes) =>
      `"${name}" är ${bytes} byte. Filer som ska konverteras får vara högst ${maxBytes} byte.`,
    unsupported: 'Den här webbläsaren kan inte konvertera ljud. Ladda upp en WAV-fil i stället.',
    unreadable: (name) => `Kunde inte läsa "${name}". Välj den igen.`,
    undecodable: (name) => `Den här webbläsaren kunde inte läsa "${name}" som ljud. Prova en WAV-, M4A- eller MP3-fil.`,
    silent: (name) => `"${name}" innehåller inget ljud.`,
  },
};
