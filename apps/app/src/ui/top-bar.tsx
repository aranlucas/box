import type { NativeStackHeaderProps } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, MAX_WIDTH, space, TAP } from './theme';

/**
 * Web-only stack header that lines up with the page: same centred MAX_WIDTH column as <Screen>,
 * title centred, back button at the column's left edge (not the window's) on wide screens.
 * iOS/Android use the native stack header (see _layout.tsx).
 */
export function TopBar({ navigation, options, route, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const title = typeof options.title === 'string' ? options.title : route.name;
  return (
    <View style={[s.bar, { paddingTop: insets.top }]}>
      <View style={s.inner}>
        <View style={s.side}>
          {back ? (
            <Pressable
              onPress={navigation.goBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              style={({ pressed }) => [s.back, pressed && s.pressed]}
            >
              <Text style={s.backText}>‹ Back</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={s.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={[s.side, s.right]}>
          {options.headerRight?.({ canGoBack: !!back, tintColor: colors.kraftDark })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { backgroundColor: colors.bg },
  inner: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    height: 56,
    paddingHorizontal: space(4),
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Equal-width sides keep the title centred whether or not there's a back button.
  side: { width: 88, alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  back: { minHeight: TAP, justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  backText: { fontSize: 17, fontWeight: '600', color: colors.kraftDark },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.ink },
});
