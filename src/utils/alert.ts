import { Alert as RNAlert, Platform } from 'react-native';

/**
 * A drop-in replacement for React Native's `Alert.alert(title, message)` --
 * use this everywhere instead, never `Alert` from 'react-native' directly.
 *
 * Why this exists: react-native-web's `Alert.alert` is a hard no-op (see
 * its source -- `static alert() {}`, does nothing at all). Since this app
 * is actually used day-to-day as the web export (`npm run serve`, then
 * "Add to Home Screen" -- see README), every `Alert.alert(...)` call in
 * the app was silently doing nothing on the platform it's really run on.
 * That's not a rendering quirk to work around per call site; it's why
 * "Save Changes"/"Mark Active"/"Mark Inactive" (and every validation
 * error) on the Classes tab looked like they did nothing at all. This
 * wraps the same call with a real fallback for web (`window.alert`,
 * which every browser actually implements) and leaves native (Expo Go on
 * iOS/Android) using the real native `Alert.alert`, unchanged.
 */
export function alert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  RNAlert.alert(title, message);
}
