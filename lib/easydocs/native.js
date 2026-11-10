// Saving and sharing inside the Android app (Capacitor).
// Browser downloads and the web share menu don't work inside an app, so these use native plugins.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNativeApp = () => Capacitor.isNativePlatform();

const FOLDER = 'EasyDocs';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function exists(path, directory) {
  try { await Filesystem.stat({ path, directory }); return true; } catch { return false; }
}

// "report.pdf" -> "report (2).pdf" if the name is taken, so earlier saves are never overwritten
async function freeName(filename, directory) {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let name = filename;
  for (let n = 2; await exists(`${FOLDER}/${name}`, directory); n++) name = `${base} (${n})${ext}`;
  return name;
}

// Saves into the phone's Documents/EasyDocs folder (visible in the Files app).
// Returns where it was saved, e.g. "Documents/EasyDocs/report.pdf".
export async function saveToDevice(blob, filename) {
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') await Filesystem.requestPermissions(); // only asks on Android 10 and older
  } catch { /* newer Android needs no permission for files the app creates */ }
  const data = await blobToBase64(blob);
  const name = await freeName(filename, Directory.Documents);
  await Filesystem.writeFile({ path: `${FOLDER}/${name}`, data, directory: Directory.Documents, recursive: true });
  return `Documents/${FOLDER}/${name}`;
}

// Opens Android's share sheet (WhatsApp, Gmail, Drive, Bluetooth, "Save to…").
export async function shareFile(blob, filename) {
  const data = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path: `share/${filename}`, data, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: `Share ${filename}` });
  } catch (err) {
    // closing the share sheet without picking an app isn't an error
    if (!/cancel/i.test(err?.message || '')) throw err;
  }
}
