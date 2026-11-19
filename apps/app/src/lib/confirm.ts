import { Alert, Platform } from 'react-native';

/** Asks before something that can't be undone. Resolves true when the user goes ahead with `action`. */
export function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
