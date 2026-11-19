import type { BoxRow } from '@mj/api';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactElement, ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
  type ScrollViewProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, MAX_WIDTH, radius, space, TAP } from './theme';

type Refresh = {
  /** Enables pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

/**
 * The stack header already sits below the status bar, so screens under it must not add the top
 * inset again (a second inset leaves a blank band that clips scrolled content). Pass `safeTop`
 * only on screens with `headerShown: false`.
 */
const edges = (safeTop: boolean) =>
  safeTop ? (['top', 'left', 'right'] as const) : (['left', 'right'] as const);

/** Scrolling behaviour shared by every screen. */
function useScrolling({ onRefresh, refreshing = false }: Refresh, hasFooter = false) {
  const insets = useSafeAreaInsets();
  return {
    // Keep the last buttons clear of the gesture bar / home indicator (the footer does that itself).
    bottom: { paddingBottom: space(4) + (hasFooter ? 0 : insets.bottom) },
    props: {
      keyboardShouldPersistTaps: 'handled',
      keyboardDismissMode: 'on-drag',
      automaticallyAdjustKeyboardInsets: true,
      refreshControl: onRefresh ? (
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.kraft}
          colors={[colors.kraft]}
        />
      ) : undefined,
    } satisfies ScrollViewProps,
  };
}

type ScreenProps = Refresh & {
  children: ReactNode;
  safeTop?: boolean;
  /** Pinned below the scrolling content, e.g. a save bar. */
  footer?: ReactNode;
};

/** Page body: a centred column that scrolls. */
export function Screen({ children, safeTop = false, footer, ...refresh }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const scrolling = useScrolling(refresh, !!footer);
  return (
    <SafeAreaView style={styles.screen} edges={edges(safeTop)}>
      <ScrollView {...scrolling.props} contentContainerStyle={[styles.scroll, scrolling.bottom]}>
        <View style={styles.column}>{children}</View>
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: space(3) + insets.bottom }]}>
          <View style={styles.footerColumn}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

type ListScreenProps<T> = Refresh & {
  /** Everything above the rows. Pass an element, so its inputs keep focus between renders. */
  header: ReactElement;
  data: readonly T[];
  keyExtractor: (item: T) => string;
  renderItem: ListRenderItem<T>;
};

/** A <Screen> whose body is a long list: rows are rendered as they scroll into view. */
export function ListScreen<T>({
  header,
  data,
  keyExtractor,
  renderItem,
  ...refresh
}: ListScreenProps<T>) {
  const scrolling = useScrolling(refresh);
  return (
    <SafeAreaView style={styles.screen} edges={edges(true)}>
      <FlatList
        {...scrolling.props}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={styles.listHeader}
        contentContainerStyle={[styles.column, styles.list, scrolling.bottom]}
      />
    </SafeAreaView>
  );
}

/** A screen that is still fetching what it shows. */
export function LoadingScreen({ safeTop = false }: { safeTop?: boolean }) {
  return (
    <Screen safeTop={safeTop}>
      <ActivityIndicator color={colors.kraft} style={styles.loading} accessibilityLabel="Loading" />
    </Screen>
  );
}

const buttonVariants = {
  primary: { bg: colors.ink, fg: '#fff', border: colors.ink },
  secondary: { bg: colors.card, fg: colors.ink, border: colors.line },
  ghost: { bg: 'transparent', fg: colors.kraftDark, border: 'transparent' },
  danger: { bg: colors.card, fg: colors.red, border: colors.redSoft },
};

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: keyof typeof buttonVariants;
  busy?: boolean;
  disabled?: boolean;
  big?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  big = false,
}: ButtonProps) {
  const v = buttonVariants[variant];
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: v.bg, borderColor: v.border },
        inactive && styles.inactive,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: v.fg }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** A header action shown as an icon alone; `label` is what a screen reader says. */
export function IconButton({
  symbol,
  label,
  onPress,
  tint = colors.kraftDark,
}: {
  symbol: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <SymbolView
        name={symbol}
        tintColor={tint}
        size={24}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

/** A text-only action for the edge of a row ("Remove", "Disconnect"); padded out to a full tap target. */
export function LinkButton({
  label,
  onPress,
  tone = 'accent',
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && styles.pressed]}
    >
      <Text style={[styles.linkText, tone === 'danger' && styles.linkDanger]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, style, ...input }: TextInputProps & { label?: string }) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...input}
      />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const bannerTones = {
  info: { bg: colors.kraftSoft, fg: colors.kraftDark },
  error: { bg: colors.redSoft, fg: colors.red },
  success: { bg: colors.greenSoft, fg: colors.green },
};

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: keyof typeof bannerTones;
  children: ReactNode;
}) {
  const { bg, fg } = bannerTones[tone];
  return (
    // Errors are announced by screen readers as soon as they appear.
    <View
      style={[styles.banner, { backgroundColor: bg }]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      <Text style={[styles.bannerText, { color: fg }]}>{children}</Text>
    </View>
  );
}

/** The small green pill on boxes that have been unpacked. */
export function UnpackedBadge() {
  return <Text style={styles.badge}>Unpacked</Text>;
}

/** The line above a box's title: its room, and whether it has been unpacked. Nothing when there is neither. */
export function BoxKicker({ box }: { box: Pick<BoxRow, 'room' | 'status'> }) {
  if (!box.room && box.status === 'packed') {
    return null;
  }
  return (
    <View style={styles.row}>
      {box.room ? <Text style={styles.kicker}>{box.room}</Text> : null}
      {box.status === 'unpacked' ? <UnpackedBadge /> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  column: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    padding: space(4),
    gap: space(4),
    flexGrow: 1,
  },
  // Rows sit closer together than the sections of a page.
  list: { gap: space(2) },
  listHeader: { marginBottom: space(2) },
  loading: { marginTop: space(10) },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingTop: space(3),
  },
  footerColumn: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space(4),
    gap: space(2),
  },
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
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  link: { minHeight: TAP, minWidth: TAP, justifyContent: 'center' },
  linkText: { fontSize: 15, fontWeight: '600', color: colors.kraftDark },
  linkDanger: { color: colors.red },
  field: { gap: space(1) },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
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
  bannerText: { fontSize: 15, lineHeight: 21 },
  badge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  /** A title with its kicker (or validation message) tucked close to it. */
  heading: { gap: space(1) },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 18, fontWeight: '700', color: colors.ink },
  /** The small caps line above a title (a house name, a room). */
  kicker: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.kraftDark,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  body: { fontSize: 16, color: colors.ink, lineHeight: 22 },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  error: { fontSize: 14, color: colors.red, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  spread: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    justifyContent: 'space-between',
  },
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
});
