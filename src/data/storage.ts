import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// A tiny key/value abstraction so the rest of the app never has to think
// about which platform it's running on. Native uses AsyncStorage; web uses
// localStorage directly (simpler and more predictable than AsyncStorage's
// web shim).
export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return AsyncStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore (e.g. private browsing quota errors)
    }
    return;
  }
  await AsyncStorage.setItem(key, value);
}
