import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeftIcon } from 'lucide-react-native';
import { api } from '@/lib/api';
import { FontFamily, FontSize, Radius, Spacing } from '@/constants/theme';
import { useThemeColors } from '@/contexts/ThemeContext';
import { Text } from '@/components/ui/Text';
import type { CompanionMessage, CompanionThread } from '@/types/api';

function MessageBlock({ message }: { message: CompanionMessage }) {
  const c = useThemeColors();
  const isUser = message.role === 'USER';

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <Text
            variant="monoSmall"
            style={{ color: c.text, lineHeight: 20 }}
          >
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.companionRow, { borderLeftColor: c.border }]}>
      <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[2], letterSpacing: 2 }}>
        MNEME
      </Text>
      <Text variant="serif" color="secondary" style={{ lineHeight: 26 }}>
        {message.content}
      </Text>
    </View>
  );
}

export default function CompanionScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contextIds, contextLabels } = useLocalSearchParams<{ contextIds?: string; contextLabels?: string }>();

  const contextItemIds = useMemo(
    () => (contextIds ? contextIds.split(',').filter(Boolean) : []),
    [contextIds],
  );
  const contextLabelList = useMemo(
    () => (contextLabels ? contextLabels.split(',').filter(Boolean) : []),
    [contextLabels],
  );
  const [suggestionsUsed, setSuggestionsUsed] = useState(false);

  const [thread, setThread] = useState<CompanionThread | null>(null);
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const scrollToEnd = useCallback((animated = true) => {
    scrollRef.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.companion.getThread();
        setThread(data);
        setMessages(data.messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load companion');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => scrollToEnd(false), 100);
    }
  }, [messages.length, scrollToEnd]);

  const handleSend = useCallback(async (overrideText?: string) => {
    const content = (overrideText ?? reply).trim();
    if (!content || sending) return;

    const optimisticUser: CompanionMessage = {
      id: `optimistic-${Date.now()}`,
      threadId: thread?.id ?? '',
      role: 'USER',
      content,
      createdAt: new Date().toISOString(),
    };

    setReply('');
    setSending(true);
    setSuggestionsUsed(true);
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      const { userMessage, companionMessage } = await api.companion.reply(
        content,
        contextItemIds.length > 0 ? contextItemIds : undefined,
      );
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        userMessage,
        companionMessage,
      ]);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }, [reply, sending, thread?.id, contextItemIds]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Back">
          <ChevronLeftIcon size={22} color={c.text} />
        </Pressable>
        <Text variant="monoSmall" color="muted" style={styles.headerTitle} numberOfLines={1}>
          companion
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={c.text} />
        </View>
      )}

      {!loading && error && (
        <View style={styles.centered}>
          <Text variant="monoSmall" color="danger">{error}</Text>
        </View>
      )}

      {!loading && !error && (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.messageList,
              messages.length === 0 && styles.messageListEmpty,
            ]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => scrollToEnd(false)}
          >
            {messages.length === 0 ? (
              <Text
                variant="serif"
                color="secondary"
                style={{ fontStyle: 'italic', textAlign: 'center' }}
              >
                Ask anything about your knowledge map.
              </Text>
            ) : (
              messages.map((msg) => <MessageBlock key={msg.id} message={msg} />)
            )}
            {sending && (
              <View style={[styles.companionRow, { borderLeftColor: c.border }]}>
                <Text variant="monoSmall" style={{ color: c.faint, marginBottom: Spacing[2], letterSpacing: 2 }}>
                  MNEME
                </Text>
                <Text variant="monoSmall" color="muted" style={{ letterSpacing: 3 }}>
                  · · ·
                </Text>
              </View>
            )}
          </ScrollView>

          {contextItemIds.length > 0 && !suggestionsUsed && (
            <View style={styles.contextBlock}>
              {contextLabelList.length > 0 && (
                <Text
                  variant="monoSmall"
                  color="muted"
                  style={styles.contextLabel}
                  numberOfLines={1}
                >
                  regarding: {contextLabelList.join(', ')}
                </Text>
              )}
              <View style={styles.suggestionRow}>
                <Pressable
                  onPress={() => handleSend('Find the connection')}
                  style={[styles.suggestionChip, { borderColor: c.border }]}
                >
                  <Text variant="monoSmall" style={{ color: c.text }}>Find the connection</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleSend("What's the tension between these ideas?")}
                  style={[styles.suggestionChip, { borderColor: c.border }]}
                >
                  <Text variant="monoSmall" style={{ color: c.text }}>What&apos;s the tension between these ideas?</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View
            style={[
              styles.inputBar,
              {
                borderTopColor: c.border,
                backgroundColor: c.background,
                paddingBottom: Math.max(insets.bottom, Spacing[3]),
              },
            ]}
          >
            <TextInput
              style={[styles.textInput, { color: c.text, fontFamily: FontFamily.mono, fontSize: FontSize.sm }]}
              value={reply}
              onChangeText={setReply}
              placeholder="ask anything..."
              placeholderTextColor={c.faint}
              multiline
              maxLength={4000}
              editable={!sending}
              onSubmitEditing={() => handleSend()}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => handleSend()}
              disabled={!reply.trim() || sending}
              style={styles.sendButton}
              accessibilityLabel="Send"
              accessibilityRole="button"
            >
              <Text
                variant="monoSmall"
                style={{ color: reply.trim() && !sending ? c.text : c.faint, fontSize: FontSize.base }}
              >
                →
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  contextBlock: {
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[3],
  },
  contextLabel: {
    marginBottom: Spacing[2],
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingVertical: 6,
    paddingHorizontal: Spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
  },
  backButton: { padding: Spacing[1] },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.5 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageList: {
    paddingHorizontal: Spacing[6],
    paddingVertical: Spacing[8],
    gap: Spacing[8],
  },
  messageListEmpty: {
    flex: 1,
    justifyContent: 'center',
  },
  companionRow: {
    borderLeftWidth: 2,
    paddingLeft: Spacing[4],
  },
  userRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    maxWidth: '82%',
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing[5],
    paddingTop: Spacing[3],
    borderTopWidth: 1,
    gap: Spacing[3],
  },
  textInput: {
    flex: 1,
    paddingVertical: Spacing[2],
    maxHeight: 120,
    lineHeight: 20,
  },
  sendButton: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    marginBottom: 2,
  },
});
