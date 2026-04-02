import React, { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useTokenOperations } from '../hooks/useTokenOperations';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Coins, Image as ImageIcon, Globe, TwitterLogo, TelegramLogo, Check, X } from '@phosphor-icons/react';

const TokenCreationForm = () => {
  const { connected } = useWallet();
  const { createToken, loading } = useTokenOperations();

  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    decimals: 9,
    totalSupply: '',
    description: '',
    image: '',
    logo: '',
    twitter: '',
    telegram: '',
    website: ''
  });

  const [authorities, setAuthorities] = useState({
    revokeMint: false,
    revokeFreeze: false,
    revokeUpdate: false
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!connected) {
      return;
    }

    const result = await createToken({
      metadata: {
        name: formData.name,
        symbol: formData.symbol,
        decimals: parseInt(formData.decimals),
        total_supply: parseInt(formData.totalSupply),
        description: formData.description,
        image: formData.image,
        logo: formData.logo,
        twitter: formData.twitter,
        telegram: formData.telegram,
        website: formData.website
      },
      revokeMintAuthority: authorities.revokeMint,
      revokeFreezeAuthority: authorities.revokeFreeze,
      revokeUpdateAuthority: authorities.revokeUpdate
    });

    if (result?.success) {
      setFormData({
        name: '',
        symbol: '',
        decimals: 9,
        totalSupply: '',
        description: '',
        image: '',
        logo: '',
        twitter: '',
        telegram: '',
        website: ''
      });
      setAuthorities({
        revokeMint: false,
        revokeFreeze: false,
        revokeUpdate: false
      });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mb-4">
          Create Your Token
        </h1>
        <p className="text-lg text-zinc-700">
          Launch your SPL token on Solana mainnet. No platform fees—only network costs.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-zinc-300 p-8">
            <div className="flex items-center gap-3 mb-6">
              <Coins size={24} weight="bold" />
              <h2 className="text-2xl font-bold tracking-tighter">Core Info</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="name" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Token Name *
                </Label>
                <Input
                  id="name"
                  data-testid="token-name-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Token"
                  required
                  className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                />
              </div>

              <div>
                <Label htmlFor="symbol" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Symbol *
                </Label>
                <Input
                  id="symbol"
                  data-testid="token-symbol-input"
                  value={formData.symbol}
                  onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                  placeholder="MTK"
                  required
                  maxLength={10}
                  className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                />
              </div>

              <div>
                <Label htmlFor="decimals" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Decimals
                </Label>
                <Input
                  id="decimals"
                  data-testid="token-decimals-input"
                  type="number"
                  value={formData.decimals}
                  onChange={(e) => setFormData({ ...formData, decimals: e.target.value })}
                  min="0"
                  max="18"
                  required
                  className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                />
              </div>

              <div>
                <Label htmlFor="supply" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Total Supply *
                </Label>
                <Input
                  id="supply"
                  data-testid="token-supply-input"
                  type="number"
                  value={formData.totalSupply}
                  onChange={(e) => setFormData({ ...formData, totalSupply: e.target.value })}
                  placeholder="1000000"
                  required
                  min="1"
                  className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                />
              </div>
            </div>

            <div className="mt-6">
              <Label htmlFor="description" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                Description
              </Label>
              <Textarea
                id="description"
                data-testid="token-description-input"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your token..."
                rows={3}
                className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black resize-none"
              />
            </div>
          </div>

          <div className="bg-white border border-zinc-300 p-8">
            <div className="flex items-center gap-3 mb-6">
              <ImageIcon size={24} weight="bold" />
              <h2 className="text-2xl font-bold tracking-tighter">Metadata</h2>
            </div>
            
            <div className="space-y-6">
              <div>
                <Label htmlFor="image" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Image URL
                </Label>
                <Input
                  id="image"
                  data-testid="token-image-input"
                  value={formData.image}
                  onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                  placeholder="https://example.com/image.png"
                  type="url"
                  className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                />
              </div>

              <div>
                <Label htmlFor="logo" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Logo URL
                </Label>
                <Input
                  id="logo"
                  data-testid="token-logo-input"
                  value={formData.logo}
                  onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
                  placeholder="https://example.com/logo.png"
                  type="url"
                  className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="twitter" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 flex items-center gap-2">
                    <TwitterLogo size={16} weight="bold" />
                    Twitter
                  </Label>
                  <Input
                    id="twitter"
                    data-testid="token-twitter-input"
                    value={formData.twitter}
                    onChange={(e) => setFormData({ ...formData, twitter: e.target.value })}
                    placeholder="@mytoken"
                    className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                  />
                </div>

                <div>
                  <Label htmlFor="telegram" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 flex items-center gap-2">
                    <TelegramLogo size={16} weight="bold" />
                    Telegram
                  </Label>
                  <Input
                    id="telegram"
                    data-testid="token-telegram-input"
                    value={formData.telegram}
                    onChange={(e) => setFormData({ ...formData, telegram: e.target.value })}
                    placeholder="t.me/mytoken"
                    className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                  />
                </div>

                <div>
                  <Label htmlFor="website" className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 flex items-center gap-2">
                    <Globe size={16} weight="bold" />
                    Website
                  </Label>
                  <Input
                    id="website"
                    data-testid="token-website-input"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder="https://mytoken.com"
                    type="url"
                    className="rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white border border-zinc-300 p-8 sticky top-24">
            <h2 className="text-2xl font-bold tracking-tighter mb-6">Security</h2>
            
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4 pb-6 border-b border-zinc-200">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">Revoke Mint Authority</span>
                    {authorities.revokeMint && <Check size={16} className="text-success" weight="bold" />}
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Prevents future minting. Creates a fixed supply.
                  </p>
                </div>
                <Switch
                  data-testid="revoke-mint-switch"
                  checked={authorities.revokeMint}
                  onCheckedChange={(checked) => setAuthorities({ ...authorities, revokeMint: checked })}
                  className="data-[state=checked]:bg-black"
                />
              </div>

              <div className="flex items-start justify-between gap-4 pb-6 border-b border-zinc-200">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">Revoke Freeze Authority</span>
                    {authorities.revokeFreeze && <Check size={16} className="text-success" weight="bold" />}
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Prevents freezing token accounts permanently.
                  </p>
                </div>
                <Switch
                  data-testid="revoke-freeze-switch"
                  checked={authorities.revokeFreeze}
                  onCheckedChange={(checked) => setAuthorities({ ...authorities, revokeFreeze: checked })}
                  className="data-[state=checked]:bg-black"
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">Revoke Update Authority</span>
                    {authorities.revokeUpdate && <Check size={16} className="text-success" weight="bold" />}
                  </div>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Prevents metadata updates permanently.
                  </p>
                </div>
                <Switch
                  data-testid="revoke-update-switch"
                  checked={authorities.revokeUpdate}
                  onCheckedChange={(checked) => setAuthorities({ ...authorities, revokeUpdate: checked })}
                  className="data-[state=checked]:bg-black"
                />
              </div>
            </div>

            <Button
              type="submit"
              data-testid="create-token-submit"
              disabled={!connected || loading}
              className="w-full mt-8 bg-black text-white hover:bg-zinc-800 rounded-none h-12 font-bold tracking-wide transition-all duration-200 hover:shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] hover:-translate-y-1"
            >
              {loading ? 'Creating...' : connected ? 'Create Token' : 'Connect Wallet'}
            </Button>

            {!connected && (
              <p className="text-xs text-center text-zinc-500 mt-4">
                Connect your wallet to create tokens
              </p>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};

export default TokenCreationForm;
