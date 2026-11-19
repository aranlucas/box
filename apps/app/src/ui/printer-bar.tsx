import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { useRemotePrinters } from '@/lib/household';
import { connectPrinter, disconnectPrinter, usePrinter } from '@/lib/printer';
import { queries } from '@/lib/queries';
import { isReady } from '@/lib/store';

import { Button, Card, IconButton, LinkButton, styles } from './components';
import { colors, radius, space } from './theme';

/** What printing a label for `houseId` would use right now: this device's printer, or one elsewhere in the house. */
export function usePrinting(houseId: string) {
  const printer = usePrinter();
  const [remote] = useRemotePrinters(houseId);
  const local = isReady(printer.status);
  // A printer on another device in that house, when this device has none connected.
  const via = local ? undefined : remote;
  // `unavailable`: no printer in reach, and this device cannot connect one itself.
  const unreachable = printer.status === 'unsupported' ? 'unavailable' : 'setup';
  return { printer, via, availability: local || via ? 'ready' : unreachable } as const;
}

const ICON = {
  ready: {
    label: 'printer available',
    symbol: { ios: 'printer.fill', android: 'print', web: 'print' },
    tint: colors.green,
  },
  setup: {
    label: 'connect a printer',
    symbol: { ios: 'printer', android: 'print', web: 'print' },
    tint: colors.muted,
  },
  unavailable: {
    label: 'printing unavailable',
    symbol: { ios: 'printer', android: 'print_disabled', web: 'print_disabled' },
    tint: colors.muted,
  },
} as const;

/** The header's printer icon: shows at a glance whether a label can be printed. Opens the printer controls. */
export function PrinterButton({ houseId, onPress }: { houseId: string; onPress: () => void }) {
  const icon = ICON[usePrinting(houseId).availability];
  return (
    <IconButton
      symbol={icon.symbol}
      tint={icon.tint}
      label={`Printer options, ${icon.label}`}
      onPress={onPress}
    />
  );
}

/** The printer controls, as a sheet over the screen. */
export function PrinterSheet({
  houseId,
  visible,
  onClose,
}: {
  houseId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const printer = usePrinter();
  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="fade">
      <View style={s.modal}>
        <Card style={s.modalCard}>
          <Text accessibilityRole="header" style={styles.h2}>
            Printer
          </Text>
          <PrinterBar houseId={houseId} />
          {/* Lists every nearby Bluetooth device, for a printer that doesn't call itself a D30. */}
          {printer.status === 'disconnected' ? (
            <LinkButton
              label="Printer not listed?"
              onPress={() => {
                void connectPrinter({ acceptAll: true });
              }}
            />
          ) : null}
          <Button label="Done" variant="secondary" onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}

/** The printer icon together with the sheet it opens. */
export function PrinterMenu({ houseId }: { houseId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PrinterButton
        houseId={houseId}
        onPress={() => {
          setOpen(true);
        }}
      />
      <PrinterSheet
        houseId={houseId}
        visible={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** A status pill: green dot when a printer is available, grey when not. */
function Status({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[s.chip, on ? s.on : s.off]} accessibilityRole="text">
      <View style={[s.dot, on && s.dotOn]} />
      <Text style={s.chipText}>{label}</Text>
    </View>
  );
}

const HELP = {
  connect: 'Or connect the D30 on any device in your house, and everyone can print through it.',
  unsupported:
    'No printer is connected in your house. Connect the D30 from the Android app or Chrome on another device and keep it open. Then you can print from here.',
  shared: 'Shared with your house. Keep the app open here so others can print.',
};

/**
 * Printer status + connect control for one house. When this device has no printer but another
 * device in the house does, it offers to print through that one. `showTable` adds the house's
 * printer table.
 */
export function PrinterBar({
  houseId,
  showTable = false,
}: {
  houseId: string;
  showTable?: boolean;
}) {
  const { printer, via } = usePrinting(houseId);
  useQuery(queries.printerReconnect());
  const connect = useMutation({ mutationFn: connectPrinter });

  return (
    <View style={s.bar}>
      {isReady(printer.status) ? (
        <>
          <View style={s.row}>
            <Status
              on
              label={
                printer.status === 'printing'
                  ? `Printing on ${printer.name}…`
                  : `Printer: ${printer.name}`
              }
            />
            <LinkButton label="Disconnect" onPress={disconnectPrinter} />
          </View>
          <Text style={s.help}>{HELP.shared}</Text>
        </>
      ) : (
        <>
          <View style={s.row}>
            {printer.status === 'connecting' ? <Status on={false} label="Connecting…" /> : null}
            {printer.status !== 'connecting' && via ? (
              <Status on label={`Print via ${via.device_name}`} />
            ) : null}
            {printer.status === 'disconnected' ? (
              <Button
                label={via ? 'Connect one here instead' : 'Connect printer'}
                variant="secondary"
                onPress={() => {
                  connect.mutate({});
                }}
              />
            ) : null}
          </View>
          {via ? null : (
            <Text style={s.help}>
              {printer.status === 'unsupported' ? HELP.unsupported : HELP.connect}
            </Text>
          )}
        </>
      )}
      {printer.error ? <Text style={styles.error}>{printer.error}</Text> : null}
      {showTable ? <HouseholdTable houseId={houseId} /> : null}
    </View>
  );
}

/** The house's connection status table: every device in it that can print right now. */
function HouseholdTable({ houseId }: { houseId: string }) {
  const deviceId = useQuery(queries.deviceId()).data;
  const printers = useQuery(queries.printers(houseId)).data ?? [];
  if (printers.length === 0) {
    return null;
  }
  return (
    <View style={s.table} accessibilityLabel="Printers in this house">
      <Text style={s.tableHead}>Printers in this house</Text>
      {printers.map((p) => (
        <View key={p.device_id} style={s.tableRow}>
          <View style={[s.dot, s.dotOn]} />
          <Text style={s.tableName} numberOfLines={1}>
            {p.device_name}
            {p.device_id === deviceId ? ' (this device)' : ''}
          </Text>
          <Text style={s.tableMeta}>{p.printer_name ?? 'D30'}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  modal: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space(4),
    backgroundColor: 'rgba(29, 26, 22, 0.4)',
  },
  modalCard: { width: '100%', maxWidth: 360 },
  bar: { gap: space(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: space(3),
    rowGap: space(2),
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(3),
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  on: { backgroundColor: colors.greenSoft, borderColor: colors.greenSoft },
  off: { backgroundColor: colors.card, borderColor: colors.line },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.muted },
  dotOn: { backgroundColor: colors.green },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  help: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  table: {
    marginTop: space(1),
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: space(1),
  },
  tableHead: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 28 },
  tableName: { flex: 1, fontSize: 14, color: colors.ink },
  tableMeta: { fontSize: 13, color: colors.muted },
});
