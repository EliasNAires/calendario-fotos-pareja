// DriveSource: Google Drive con Google Identity Services. Todavía es un stub (ver #6).

const notImplemented = async () => {
  throw new Error('DriveSource no implementado todavía. Probá con ?demo.');
};

export function createDriveSource() {
  return {
    signIn: notImplemented,
    isSignedIn: () => false,
    listPhotos: notImplemented,
    thumbnailUrl: notImplemented,
    readAlbum: notImplemented,
    writeAlbum: notImplemented,
  };
}
