import { useController, type Control, type FieldValues, type Path, type RegisterOptions } from 'react-hook-form';
import { Text, View, type TextInputProps, type ViewStyle } from 'react-native';

import { Field } from './components';
import { colors, space } from './theme';

type Props<T extends FieldValues> = Omit<TextInputProps, 'value' | 'onChangeText' | 'onBlur'> & {
  control: Control<T>;
  name: Path<T>;
  rules?: RegisterOptions<T, Path<T>>;
  label?: string;
  containerStyle?: ViewStyle;
};

/** A text Field bound to react-hook-form, showing the field's validation message. */
export function FormField<T extends FieldValues>({ control, name, rules, containerStyle, ...props }: Props<T>) {
  const { field, fieldState } = useController({ control, name, rules });
  return (
    <View style={[{ gap: space(1) }, containerStyle]}>
      <Field {...props} value={field.value ?? ''} onChangeText={field.onChange} onBlur={field.onBlur} />
      {fieldState.error?.message ? <Text style={{ color: colors.red, fontSize: 13 }}>{fieldState.error.message}</Text> : null}
    </View>
  );
}
