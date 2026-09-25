import { useCallback } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, type ListRenderItemInfo } from 'react-native';

import ItemCard from '@/src/components/ItemCard';
import type { ClosetItem } from '@/src/types';

const COLUMNS = 3;
const GAP = 8;

export default function ClosetGrid({
  items,
  onPressItem,
  contentInsetBottom = 0,
}: {
  items: ClosetItem[];
  onPressItem: (item: ClosetItem) => void;
  contentInsetBottom?: number;
}) {
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - GAP * (COLUMNS + 1)) / COLUMNS);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ClosetItem>) => (
      <ItemCard item={item} size={tile} onPress={onPressItem} />
    ),
    [tile, onPressItem]
  );

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      numColumns={COLUMNS}
      renderItem={renderItem}
      columnWrapperStyle={styles.row}
      contentContainerStyle={[styles.content, { paddingBottom: GAP + contentInsetBottom }]}
      initialNumToRender={18}
      windowSize={5}
      removeClippedSubviews
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: GAP,
    paddingTop: GAP,
  },
  row: {
    gap: GAP,
    marginBottom: GAP,
  },
});
