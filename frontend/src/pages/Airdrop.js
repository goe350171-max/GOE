import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { PaperPlaneTilt, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';

const Airdrop = () => {
  const { connected } = useWallet();
  const [formData, setFormData] = useState({
    mintAddress: '',
    recipients: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!connected) {
      toast.error('Please connect your wallet');
      return;
    }

    setLoading(true);
    toast.info('Airdrop functionality coming soon!');
    setLoading(false);
  };

  const parseRecipients = () => {
    if (!formData.recipients.trim()) return [];
    
    const lines = formData.recipients.split('\n').filter(line => line.trim());
    const parsed = [];
    
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length === 2) {
        parsed.push({ address: parts[0], amount: parts[1] });
      }
    }
    
    return parsed;
  };

  const recipientCount = parseRecipients().length;
  const totalAmount = parseRecipients().reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mb-4">
          Token Airdrop
        </h1>
        <p className="text-lg text-zinc-700">
          Distribute tokens to multiple addresses in a single transaction
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white border border-zinc-300 p-8">
          <div className="flex items-center gap-3 mb-6">
            <PaperPlaneTilt size={24} weight="bold" />
            <h2 className="text-2xl font-bold tracking-tighter">Airdrop Details</h2>
          </div>

          <div className="space-y-6">
            <div>
              <Label htmlFor="mintAddress" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                Token Mint Address *
              </Label>
              <Input
                id="mintAddress"
                data-testid="airdrop-mint-input"
                value={formData.mintAddress}
                onChange={(e) => setFormData({ ...formData, mintAddress: e.target.value })}
                placeholder="Enter token mint address..."
                required
                className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black font-mono text-sm"
              />
            </div>

            <div>
              <Label htmlFor="recipients" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                Recipients (CSV Format) *
              </Label>
              <p className="text-xs text-zinc-600 mb-2 leading-relaxed">
                Enter one recipient per line in format: <code className="bg-zinc-100 px-1 py-0.5">wallet_address, amount</code>
              </p>
              <Textarea
                id="recipients"
                data-testid="airdrop-recipients-input"
                value={formData.recipients}
                onChange={(e) => setFormData({ ...formData, recipients: e.target.value })}
                placeholder={"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU, 100\nD9Dqk1xXGkXwZ6gWE8FqYvJ2qJRdMnS6YZwN9yQqYcVm, 250\n3KJmLvQwNh8vJLBQZYKi7nQWYJL8t6cXpxF4zXVJ8jWh, 500"}
                rows={8}
                required
                className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black font-mono text-sm resize-none"
              />
            </div>
          </div>
        </div>

        {recipientCount > 0 && (
          <div className="bg-zinc-50 border border-zinc-300 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-700 mb-4">
              Summary
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-zinc-600 mb-1">Total Recipients</p>
                <p className="text-2xl font-bold">{recipientCount}</p>
              </div>
              <div>
                <p className="text-zinc-600 mb-1">Total Amount</p>
                <p className="text-2xl font-bold">{totalAmount.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-yellow-50 border border-yellow-300 p-6">
          <div className="flex items-start gap-3">
            <Warning size={24} weight="bold" className="text-yellow-700 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900 mb-2">Important Notes</h3>
              <ul className="text-sm text-yellow-800 space-y-1 leading-relaxed">
                <li>• Ensure all recipient addresses are valid Solana addresses</li>
                <li>• You must have sufficient token balance for the airdrop</li>
                <li>• Network fees apply for each transaction batch</li>
                <li>• Large airdrops will be split into multiple transactions</li>
              </ul>
            </div>
          </div>
        </div>

        <Button
          type="submit"
          data-testid="execute-airdrop-btn"
          disabled={!connected || loading || recipientCount === 0}
          className="w-full bg-black text-white hover:bg-zinc-800 rounded-none h-14 text-lg font-bold tracking-wide transition-all duration-200 hover:shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] hover:-translate-y-1"
        >
          {loading ? 'Processing...' : connected ? `Execute Airdrop (${recipientCount} recipients)` : 'Connect Wallet'}
        </Button>

        {!connected && (
          <p className="text-sm text-center text-zinc-500">
            Connect your wallet to execute airdrops
          </p>
        )}
      </form>
    </div>
  );
};

export default Airdrop;
