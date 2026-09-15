// Regression test for the real bug the user hit: react-native-web's
// Alert.alert is a hard no-op (`static alert() {}`), so every Alert.alert
// call in the app was silently doing nothing on web -- which is how this
// app is actually run day-to-day (`npm run serve` + "Add to Home Screen",
// see README/DESIGN.md). "Save Changes"/"Mark Active"/"Mark Inactive" on
// the Classes tab looked like they did nothing because of this, not
// because the underlying save was broken.

import { Alert, Platform } from 'react-native';

import { alert } from '../alert';

describe('alert', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    jest.restoreAllMocks();
    Platform.OS = originalOS;
  });

  it('uses the real native Alert.alert on native platforms', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    alert('Title', 'Message');
    expect(spy).toHaveBeenCalledWith('Title', 'Message');
  });

  it('falls back to window.alert on web, where Alert.alert is a no-op', () => {
    Platform.OS = 'web';
    const rnAlertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const windowAlertSpy = jest.fn();
    // @ts-expect-error -- window isn't typed as having `alert` in this RN test environment
    global.window = { alert: windowAlertSpy };

    alert('Title', 'Message');

    expect(windowAlertSpy).toHaveBeenCalledWith('Title\n\nMessage');
    expect(rnAlertSpy).not.toHaveBeenCalled(); // never falls through to the no-op

    // @ts-expect-error -- cleanup
    delete global.window;
  });

  it('omits the blank line when there is no message', () => {
    Platform.OS = 'web';
    const windowAlertSpy = jest.fn();
    // @ts-expect-error -- window isn't typed as having `alert` in this RN test environment
    global.window = { alert: windowAlertSpy };

    alert('Just a title');

    expect(windowAlertSpy).toHaveBeenCalledWith('Just a title');

    // @ts-expect-error -- cleanup
    delete global.window;
  });
});
