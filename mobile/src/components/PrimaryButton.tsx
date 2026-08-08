import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from 'react-native';
import { colors, radii } from '../lib/theme';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  style?: ViewStyle;
};

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
}: Props) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        isPrimary && styles.primary,
        variant === 'ghost' && styles.ghost,
        isDanger && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#111' : colors.white} />
      ) : (
        <Text
          style={[
            styles.text,
            isPrimary && styles.textPrimary,
            variant === 'ghost' && styles.textGhost,
            isDanger && styles.textDanger,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primary: {
    backgroundColor: colors.yellow,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  textPrimary: {
    color: '#111111',
  },
  textGhost: {
    color: colors.white,
  },
  textDanger: {
    color: colors.white,
  },
});
