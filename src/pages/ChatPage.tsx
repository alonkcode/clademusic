import { PageLayout } from '@/components/shared';
import { LiveChat } from '@/components/LiveChat';

export default function ChatPage() {
  return (
    <PageLayout title="Chat">
      <div className="max-w-3xl mx-auto">
        <LiveChat roomType="global" />
      </div>
    </PageLayout>
  );
}
