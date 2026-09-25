import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Sub-directory of the app's document directory where closet photos live. */
const CLOSET_DIR = 'closet';

/** Long edge, in pixels, that every imported photo is resized down to. */
const MAX_EDGE = 1024;

/** JPEG quality used when re-encoding. Keeps /tag payloads at ~150-300 KB. */
const JPEG_QUALITY = 0.7;

export type PickResult =
  | { status: 'ok'; assets: ImagePicker.ImagePickerAsset[] }
  | { status: 'cancelled' }
  | { status: 'denied'; canAskAgain: boolean };

export interface ImportedPhoto {
  id: string;
  /** Absolute `file://` URI, valid for this app launch. */
  photoUri: string;
}

/* ------------------------------------------------------------------ paths */

function closetDirectory(): Directory {
  return new Directory(Paths.document, CLOSET_DIR);
}

/**
 * The persisted form of a photo location is just its file name — see
 * `toPhotoFileName` / `toPhotoUri` in `src/store.tsx` for why.
 */
export function photoFileName(id: string): string {
  return `${id}.jpg`;
}

/** Rebuilds an absolute `file://` URI from a stored file name. */
export function photoUriFor(fileName: string): string {
  return new File(closetDirectory(), fileName).uri;
}

/** True if the photo behind this absolute URI is still on disk. */
export function photoExists(photoUri: string): boolean {
  try {
    return new File(photoUri).exists;
  } catch (error) {
    console.warn('[photos] could not stat photo', photoUri, error);
    return false;
  }
}

function ensureClosetDirectory(): void {
  const dir = closetDirectory();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
}

/* ------------------------------------------------------------ permissions */

async function ensureCameraPermission(): Promise<
  { granted: true } | { granted: false; canAskAgain: boolean }
> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return { granted: true };
  if (!current.canAskAgain) return { granted: false, canAskAgain: false };

  const asked = await ImagePicker.requestCameraPermissionsAsync();
  if (asked.granted) return { granted: true };
  return { granted: false, canAskAgain: asked.canAskAgain };
}

async function ensureLibraryPermission(): Promise<
  { granted: true } | { granted: false; canAskAgain: boolean }
> {
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  // 'limited' access (iOS 14+) still returns granted: true and is enough for us.
  if (current.granted) return { granted: true };
  if (!current.canAskAgain) return { granted: false, canAskAgain: false };

  const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (asked.granted) return { granted: true };
  return { granted: false, canAskAgain: asked.canAskAgain };
}

/* ---------------------------------------------------------------- picking */

/** Opens the photo library. Multi-select is allowed. Asks for access first. */
export async function pickFromLibrary(): Promise<PickResult> {
  const permission = await ensureLibraryPermission();
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 1, // we re-encode ourselves in importAsset
  });

  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
  return { status: 'ok', assets: result.assets };
}

/** Opens the camera for a single shot. Asks for access first. */
export async function pickFromCamera(): Promise<PickResult> {
  const permission = await ensureCameraPermission();
  if (!permission.granted) {
    return { status: 'denied', canAskAgain: permission.canAskAgain };
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1, // we re-encode ourselves in importAsset
  });

  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
  return { status: 'ok', assets: result.assets };
}

/* --------------------------------------------------------------- importing */

/**
 * Resizes `uri` to `MAX_EDGE` on its long edge, re-encodes as JPEG q0.7 and
 * copies the result into `documentDirectory/closet/<id>.jpg`.
 *
 * `sourceSize` comes from the picker asset when available; without it we do an
 * extra render pass just to read the dimensions.
 */
export async function importAsset(
  uri: string,
  sourceSize?: { width: number; height: number }
): Promise<ImportedPhoto> {
  let width = sourceSize?.width ?? 0;
  let height = sourceSize?.height ?? 0;

  if (!(width > 0 && height > 0)) {
    const probe = await ImageManipulator.manipulate(uri).renderAsync();
    width = probe.width;
    height = probe.height;
    probe.release();
  }

  const context = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }

  const rendered = await context.renderAsync();
  let saved;
  try {
    saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  } finally {
    rendered.release();
  }

  ensureClosetDirectory();

  const id = Crypto.randomUUID();
  const destination = new File(closetDirectory(), photoFileName(id));
  const temp = new File(saved.uri);
  await temp.move(destination, { overwrite: true });

  return { id, photoUri: destination.uri };
}

/* ---------------------------------------------------------------- deleting */

/** Removes a photo from disk. Missing files are not an error. */
export function deletePhoto(photoUri: string): void {
  try {
    const file = new File(photoUri);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('[photos] could not delete photo', photoUri, error);
  }
}

/* ---------------------------------------------------------------- reading */

/**
 * Reads a stored photo as a single-line base64 string, ready for the `/tag`
 * proxy endpoint. Unused until Milestone 3.
 */
export async function readBase64(photoUri: string): Promise<string> {
  return new File(photoUri).base64();
}
