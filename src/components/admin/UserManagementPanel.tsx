/**
 * User Management Panel
 * 
 * Admin component for managing users:
 * - Search and filter users
 * - View user details
 * - Ban/unban users
 * - Delete accounts
 * - Assign roles
 */

import { useState } from 'react';
import { useAdminUsers } from '@/hooks/api/useAdmin';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  Ban,
  Trash2,
  Shield,
  User,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export function UserManagementPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<'ban' | 'delete' | 'role' | null>(null);

  const limit = 20;
  const offset = page * limit;

  const { data, isLoading } = useAdminUsers({
    search: searchQuery,
    limit,
    offset,
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const handleAction = (user: any, action: 'ban' | 'delete' | 'role') => {
    setSelectedUser(user);
    setActionType(action);
    setActionDialogOpen(true);
  };

  const executeAction = async () => {
    // TODO: Implement actual actions
    console.log(`Executing ${actionType} on user:`, selectedUser);
    setActionDialogOpen(false);
    setSelectedUser(null);
    setActionType(null);
  };

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold">User Management</h3>
          <p className="text-sm text-muted-foreground">
            {total} total users
          </p>
        </div>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0); // Reset to first page on search
            }}
          />
        </div>
      </div>

      {/* User List */}
      <div className="space-y-2">
        {isLoading && (
          <div className="text-center py-12 text-muted-foreground">
            Loading users...
          </div>
        )}

        {!isLoading && users.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No users found
          </div>
        )}

        {users.map((user: any) => (
          <div
            key={user.id}
            className="p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={user.avatar_url} />
                  <AvatarFallback>
                    <User className="w-4 h-4" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">
                      {user.username || user.email?.split('@')[0]}
                    </p>
                    {user.user_roles?.some((r: any) => r.role === 'admin') && (
                      <Badge variant="destructive" className="text-xs">
                        <Shield className="w-3 h-3 mr-1" />
                        Admin
                      </Badge>
                    )}
                    {user.banned_until && new Date(user.banned_until) > new Date() && (
                      <Badge variant="outline" className="text-xs text-destructive">
                        <Ban className="w-3 h-3 mr-1" />
                        Banned
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {user.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Joined {formatDistanceToNow(new Date(user.created_at))} ago
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction(user, 'role')}
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Roles
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction(user, 'ban')}
                  disabled={user.user_roles?.some((r: any) => r.role === 'admin')}
                >
                  <Ban className="w-4 h-4 mr-2" />
                  Ban
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAction(user, 'delete')}
                  disabled={user.user_roles?.some((r: any) => r.role === 'admin')}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === 'ban' && 'Ban User'}
              {actionType === 'delete' && 'Delete User'}
              {actionType === 'role' && 'Manage Roles'}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'ban' && `Ban ${selectedUser?.username || selectedUser?.email} from the platform?`}
              {actionType === 'delete' && `Permanently delete ${selectedUser?.username || selectedUser?.email}? This cannot be undone.`}
              {actionType === 'role' && `Manage roles for ${selectedUser?.username || selectedUser?.email}`}
            </DialogDescription>
          </DialogHeader>

          {actionType === 'role' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Role</label>
                <Select defaultValue="user">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="moderator">Moderator</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {actionType === 'ban' && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Ban Duration</label>
                <Select defaultValue="7">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 day</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="permanent">Permanent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Reason</label>
                <Input placeholder="Enter ban reason..." />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={actionType === 'delete' ? 'destructive' : 'default'}
              onClick={executeAction}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
