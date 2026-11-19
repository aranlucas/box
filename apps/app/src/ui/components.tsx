import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, MAX_WIDTH, radius, space } from './theme';

/**
 * Page body. The stack header already sits below the status bar, so screens under it must not
 * add the top inset again (a second inset leaves a blank band that clips scrolled content).
 * Pass `safeTop` only on screens with `headerShown: false`.
 */
type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  safeTop?: boolean;
  /** Enables pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function Screen({ children, scroll = true, safeTop = false, onRefresh, refreshing = false }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const inner = <View style={styles.inner}>{children}</View>;
  const edges = safeTop ? (['top', 'left', 'right'] as const) : (['left', 'right'] as const);
  return (
    <SafeAreaView style={styles.screen} edges={scroll ? edges : [...edges, 'bottom']}>
      {scroll ? (
        <ScrollView
          // Keep the last buttons clear of the gesture bar / home indicator.
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space(4) }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.kraft} colors={[colors.kraft]} />
            ) : undefined
          }>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  big?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', busy, disabled, big, style }: ButtonProps) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: v.bg, borderColor: v.border },
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: v.fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const buttonVariants = {
  primary: { bg: colors.ink, fg: '#fff', border: colors.ink },
  secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
  ghost: { bg: 'transparent', fg: colors.kraftDark, border: 'transparent' },
  danger: { bg: colors.card, fg: colors.red, border: colors.redSoft },
};

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: space(1) }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const bg = tone === 'error' ? colors.redSoft : tone === 'success' ? colors.greenSoft : colors.kraftSoft;
  const fg = tone === 'error' ? colors.red : tone === 'success' ? colors.green : colors.kraftDark;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 15, lineHeight: 21 }}>{children}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  inner: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space(4), gap: space(4), flexGrow: 1 },
  button: {
    minHeight: 48,
    paddingHorizontal: space(5),
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBig: { minHeight: 64, borderRadius: radius.lg },
  buttonText: { fontSize: 16, fontWeight: '600' },
  buttonTextBig: { fontSize: 19, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: space(3),
    fontSize: 17,
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space(4),
    gap: space(3),
  },
  banner: { borderRadius: radius.md, padding: space(3) },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, color: colors.ink, lineHeight: 22 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
});
