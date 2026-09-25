import { Image } from 'expo-image';
import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import type { ClosetItem } from '@/src/types';

const STATUS_LABEL: Record<ClosetItem['tagStatus'], string> = {
  pending: 'Pending',
  tagging: 'Tagging…',
  tagged: 'Tagged',
  failed: 'Failed',
};

const STATUS_COLOR: Record<ClosetItem['tagStatus'], string> = {
  pending: 'rgba(60,60,67,0.75)',
  tagging: 'rgba(47,149,220,0.9)',
  tagged: 'rgba(52,164,90,0.9)',
  failed: 'rgba(200,60,55,0.9)',
};

export default function ItemCard({
  item,
  size,
  onPress,
}: {
  item: ClosetItem;
  size: number;
  onPress: (item: ClosetItem) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, { width: size, height: size, opacity: pressed ? 0.7 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Clothing item, ${STATUS_LABEL[item.tagStatus]}`}>
      <Image
        source={{ uri: item.photoUri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        recyclingKey={item.id}
        transition={120}
      />
      {item.tagStatus !== 'tagged' ? (
        <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.tagStatus] }]}>
          <Text style={styles.badgeText} lightColor="#fff" darkColor="#fff">
            {STATUS_LABEL[item.tagStatus]}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
