import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { SearchIcon, XIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import type { SearchResults } from '@/types/api';
import { Colors, FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { Text } from '@/components/ui/Text';
import { Badge } from '@/components/ui/Badge';
import { UserCard } from '@/components/profile/UserCard';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';

const FEATURED_TOPICS = [
  'philosophy', 'economics', 'design', 'AI', 'film', 'history',
  'literature', 'science', 'psychology', 'politics',
];

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function SearchScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebounce(query.trim(), 350);

  useEffect(() => {
    if (!debouncedQuery) {
      setResults(null);
      return;
    }
    setLoading(true);
    api.search.query({ query: debouncedQuery })
      .then(setResults)
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults(null);
    inputRef.current?.focus();
  }, []);

  const hasResults =
    results &&
    (results.users.length > 0 || results.contentItems.length > 0 || results.topics.length > 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text
          style={{
            fontFamily: FontFamily.heading,
            fontSize: 18,
            color: Colors.primaryText,
            letterSpacing: 4,
          }}
        >
          Search
        </Text>
      </View>

      <View style={styles.searchBar}>
        <SearchIcon size={18} color={Colors.mutedText} style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="People, content, or topics…"
          placeholderTextColor={Colors.mutedText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Search"
        />
        {query.length > 0 && (
          <Pressable onPress={clearSearch} accessibilityLabel="Clear search" style={styles.clearBtn}>
            <XIcon size={16} color={Colors.mutedText} />
          </Pressable>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!debouncedQuery && (
          <>
            <Text variant="label" color="muted" style={styles.sectionTitle}>
              Browse topics
            </Text>
            <View style={styles.topicsGrid}>
              {FEATURED_TOPICS.map((t) => (
                <Pressable key={t} onPress={() => router.push(`/topics/${t}`)}>
                  <Badge label={t} variant="topic" />
                </Pressable>
              ))}
            </View>
          </>
        )}

        {loading && (
          <View>
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </View>
        )}

        {!loading && debouncedQuery && !hasResults && (
          <EmptyState
            title={`No results for "${debouncedQuery}"`}
            body="Try a different name, topic, or URL."
          />
        )}

        {!loading && results && results.users.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionTitle}>
              People
            </Text>
            {results.users.map((p) => (
              <UserCard key={p.id} user={p} compact />
            ))}
          </View>
        )}

        {!loading && results && results.topics.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionTitle}>
              Topics
            </Text>
            <View style={styles.topicsGrid}>
              {results.topics.map((t) => (
                <Pressable key={t.slug} onPress={() => router.push(`/topics/${t.slug}`)}>
                  <Badge label={t.name} variant="topic" />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!loading && results && results.contentItems.length > 0 && (
          <View style={styles.section}>
            <Text variant="label" color="muted" style={styles.sectionTitle}>
              Content
            </Text>
            {results.contentItems.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push(`/content/${item.id}`)}
                style={styles.contentRow}
              >
                <View style={styles.contentInfo}>
                  {item.contentType && (
                    <Badge label={item.contentType} variant="contentType" small />
                  )}
                  <Text variant="bodyMedium" style={styles.contentTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.sourceName && (
                    <Text variant="caption" color="muted">{item.sourceName}</Text>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.elevatedSurface,
    borderRadius: Radius.xl,
    marginHorizontal: Spacing[4],
    marginVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    borderWidth: 1,
    borderColor: Colors.inputBorder,
    height: 44,
  },
  searchIcon: { marginRight: Spacing[2] },
  input: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Colors.primaryText,
    height: '100%',
  },
  clearBtn: { padding: Spacing[1] },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing[4], paddingBottom: Spacing[12] },
  section: { marginBottom: Spacing[5] },
  sectionTitle: { marginBottom: Spacing[3], marginTop: Spacing[4] },
  topicsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing[2] },
  contentRow: {
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  contentInfo: { gap: Spacing[1] },
  contentTitle: { marginTop: 4 },
});
