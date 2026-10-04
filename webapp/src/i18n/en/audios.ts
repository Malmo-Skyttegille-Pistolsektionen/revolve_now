function seconds(value: number): string {
  return `${value.toFixed(1)} s`;
}

export const audios = {
  title: 'Audios',
  dismiss: 'Dismiss',
  feedback: {
    playing: (title: string) => `Playing "${title}" on the device.`,
    playFailed: (title: string, detail: string) => `Could not play "${title}": ${detail}`,
    deleted: (title: string) => `Deleted "${title}".`,
    deleteFailed: (title: string, detail: string) => `Could not delete "${title}": ${detail}`,
    uploaded: (title: string, id: number) => `Uploaded "${title}" as clip ${id}.`,
    uploadFailed: (detail: string) => `Upload failed: ${detail}`,
    converting: (name: string) => `Converting "${name}"…`,
    alreadyDeviceFormat: (name: string) => `"${name}" is already in the device's format and is sent as it is.`,
    converted: (name: string, length: number, bytes: number) =>
      `Converted "${name}": ${seconds(length)}, ${bytes} bytes.`,
    sentUnconverted: (name: string) =>
      `This browser could not convert "${name}", so it is sent as it is for the device to check.`,
  },
  upload: {
    title: 'Upload a clip',
    file: 'Audio file',
    clipTitle: 'Title',
    clipTitlePlaceholder: 'Title',
    submit: 'Upload',
    converting: 'Converting…',
    uploading: 'Uploading…',
    hint: (maxSeconds: number) =>
      `WAV, M4A, MP3 or anything else this browser can play. It is converted here to the device's compressed format before upload, up to ${maxSeconds} s.`,
    viewOnly: 'View only — log in to play, upload or delete',
  },
  library: {
    title: 'Audio library',
    loading: 'Loading clips…',
    loadFailed: (detail: string) => `Could not load clips: ${detail}`,
    empty: 'No clips on the device.',
    columns: {
      id: 'ID',
      title: 'Title',
      source: 'Source',
      file: 'File',
      actions: 'Actions',
    },
    shipped: 'Shipped',
    uploaded: 'Uploaded',
    play: 'Play',
    delete: 'Delete',
    cancel: 'Cancel',
    confirm: 'Confirm',
  },
  rejection: {
    notWav: (name: string) => `"${name}" is not named .wav, and the device takes nothing else.`,
    tooBig: (name: string, bytes: number, maxBytes: number) =>
      `"${name}" is ${bytes} bytes. The device accepts at most ${maxBytes} bytes per clip.`,
  },
  convert: {
    tooLong: (name: string, length: number, maxLength: number) =>
      `"${name}" is ${seconds(length)} long. A converted clip can be at most ${seconds(maxLength)}.`,
    tooBig: (name: string, bytes: number, maxBytes: number) =>
      `"${name}" is ${bytes} bytes. Files to convert can be at most ${maxBytes} bytes.`,
    unsupported: 'This browser cannot convert audio. Upload a WAV instead.',
    unreadable: (name: string) => `Could not read "${name}". Pick it again.`,
    undecodable: (name: string) => `This browser could not read "${name}" as audio. Try a WAV, M4A or MP3 file.`,
    silent: (name: string) => `"${name}" holds no audio.`,
  },
};
