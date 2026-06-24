import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useTokenOperations } from '../hooks/useTokenOperations';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Coins, Image as ImageIcon, Globe, TwitterLogo, TelegramLogo, Check, X, UploadSimple, Trash, Warning } from '@phosphor-icons/react';
import axios from 'axios';
import { toast } from 'sonner';
import SuccessModal from '../components/SuccessModal';
import SafetyConfirmModal from '../components/SafetyConfirmModal';
import CostPreviewChip from '../components/CostPreviewChip';
import { validateField, validateAll } from '../utils/launchpadValidation';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TokenCreationForm = () => {
  const { connected, publicKey, disconnect } = useWallet();
  const { createToken, loading } = useTokenOperations();
  const fileInputRef = useRef(null);

  // Success modal state
  const [successData, setSuccessData] = useState(null);

  // Safety confirm modal state
  const [safetyModal, setSafetyModal] = useState(null);
  // { open, loadingSimulation, simulation, resolve }

  // Wallet disconnect detection
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (prevConnected.current && !connected) {
      toast.info('Wallet disconnected');
    }
    prevConnected.current = connected;
  }, [connected]);

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

  // Image upload state
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageIpfsUri, setImageIpfsUri] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [authorities, setAuthorities] = useState({
    revokeMint: false,
    revokeFreeze: false,
    revokeUpdate: false
  });

  // Inline field validation
  const [fieldErrors, setFieldErrors] = useState({});
  const [touched, setTouched] = useState({});

  const handleBlur = (field) => {
    const err = validateField(field, formData[field], formData);
    setTouched((t) => ({ ...t, [field]: true }));
    setFieldErrors((prev) => ({ ...prev, [field]: err }));
  };

  // Re-validate cross-field rule (supply × 10^decimals) whenever either changes
  // and the user has already touched supply.
  useEffect(() => {
    if (touched.totalSupply) {
      const err = validateField('totalSupply', formData.totalSupply, formData);
      setFieldErrors((prev) => ({ ...prev, totalSupply: err }));
    }
  }, [formData.decimals, formData.totalSupply, touched.totalSupply]);

  const showError = (field) => touched[field] && fieldErrors[field];
  const inputClass = (field, base = '') =>
    `${base} rounded-none focus:ring-1 ${
      showError(field)
        ? 'border-red-500 focus:border-red-600 focus:ring-red-300'
        : 'border-zinc-300 focus:border-black focus:ring-black'
    }`;

  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  const validateFile = (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Use PNG, JPEG, GIF, WEBP, or SVG.');
      return false;
    }
    if (file.size > MAX_SIZE) {
      toast.error(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 5MB.`);
      return false;
    }
    return true;
  };

  const handleFile = (file) => {
    if (!validateFile(file)) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImageIpfsUri(''); // Clear any previous IPFS URI
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const uploadImage = async () => {
    if (!imageFile) return null;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', imageFile);

      const res = await axios.post(`${API}/upload-image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const { ipfsUri, gatewayUrl } = res.data;
      setImageIpfsUri(ipfsUri);
      toast.success('Image uploaded to IPFS!');
      return ipfsUri;
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message;
      toast.error(`Image upload failed: ${msg}`);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageIpfsUri('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!connected) return;

    // Inline validation gate — show errors instead of attempting submit
    const { errors, isValid } = validateAll(formData);
    if (!isValid) {
      setFieldErrors(errors);
      setTouched({
        name: true, symbol: true, decimals: true, totalSupply: true,
        description: true, image: true, twitter: true, telegram: true, website: true,
      });
      toast.error('Please fix the highlighted fields');
      return;
    }

    // Upload image to IPFS first if a file was selected
    let finalImageUri = imageIpfsUri || formData.image || '';
    if (imageFile && !imageIpfsUri) {
      const uploaded = await uploadImage();
      if (!uploaded) return; // Upload failed, don't proceed
      finalImageUri = uploaded;
    }

    let result;

    try {
      result = await createToken({
        metadata: {
          name: formData.name,
          symbol: formData.symbol,
          decimals: parseInt(formData.decimals),
          total_supply: parseInt(formData.totalSupply),
          description: formData.description,
          image: finalImageUri,
          logo: finalImageUri,
          twitter: formData.twitter,
          telegram: formData.telegram,
          website: formData.website
        },
        revokeMintAuthority: authorities.revokeMint,
        revokeFreezeAuthority: authorities.revokeFreeze,
        revokeUpdateAuthority: authorities.revokeUpdate
      }, {
        confirmBeforeSign: ({ simulation }) =>
          new Promise((resolve) => {
            setSafetyModal({
              open: true,
              loadingSimulation: false,
              simulation,
              resolve,
            });
          }),
     });
   } catch (err) {
     console.error(err);
     return;
   }

   if (result?.success) {
      // Show success modal with all the data
      setSuccessData({
        mint: result.mint,
        ata: result.ata,
        signature: result.signature,
        totalSupply: result.totalSupply,
        verified: result.verified,
        imageUri: finalImageUri,
        explorerUrl: result.explorerUrl,
        name: formData.name,
        symbol: formData.symbol,
      });

      setFormData({
        name: '', symbol: '', decimals: 9, totalSupply: '',
        description: '', image: '', logo: '',
        twitter: '', telegram: '', website: ''
      });
      setAuthorities({ revokeMint: false, revokeFreeze: false, revokeUpdate: false });
      removeImage();
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
                  onBlur={() => handleBlur('name')}
                  placeholder="My Token"
                  required
                  className={inputClass('name')}
                />
                {showError('name') && (
                  <p data-testid="error-name" className="text-xs text-red-600 mt-1.5">{fieldErrors.name}</p>
                )}
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
                  onBlur={() => handleBlur('symbol')}
                  placeholder="MTK"
                  required
                  maxLength={12}
                  className={inputClass('symbol')}
                />
                {showError('symbol') && (
                  <p data-testid="error-symbol" className="text-xs text-red-600 mt-1.5">{fieldErrors.symbol}</p>
                )}
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
                  onBlur={() => handleBlur('decimals')}
                  min="0"
                  max="18"
                  required
                  className={inputClass('decimals')}
                />
                {showError('decimals') && (
                  <p data-testid="error-decimals" className="text-xs text-red-600 mt-1.5">{fieldErrors.decimals}</p>
                )}
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
                  onBlur={() => handleBlur('totalSupply')}
                  placeholder="1000000"
                  required
                  min="1"
                  className={inputClass('totalSupply')}
                />
                {showError('totalSupply') && (
                  <p data-testid="error-totalSupply" className="text-xs text-red-600 mt-1.5">{fieldErrors.totalSupply}</p>
                )}
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
                onBlur={() => handleBlur('description')}
                placeholder="Describe your token..."
                rows={3}
                className={inputClass('description', 'resize-none')}
              />
              {showError('description') && (
                <p data-testid="error-description" className="text-xs text-red-600 mt-1.5">{fieldErrors.description}</p>
              )}
            </div>
          </div>

          <div className="bg-white border border-zinc-300 p-8">
            <div className="flex items-center gap-3 mb-6">
              <ImageIcon size={24} weight="bold" />
              <h2 className="text-2xl font-bold tracking-tighter">Metadata</h2>
            </div>
            
            <div className="space-y-6">
              {/* Drag-and-drop image upload */}
              <div>
                <Label className="text-xs uppercase tracking-wider font-semibold text-zinc-500 mb-2 block">
                  Token Image *
                </Label>

                {imagePreview ? (
                  <div className="relative border border-zinc-300 bg-zinc-50 p-4">
                    <div className="flex items-start gap-6">
                      <img
                        src={imagePreview}
                        alt="Token preview"
                        data-testid="image-preview"
                        className="w-32 h-32 object-cover border border-zinc-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{imageFile?.name}</p>
                        <p className="text-xs text-zinc-500 mt-1">
                          {imageFile ? `${(imageFile.size / 1024).toFixed(1)} KB` : ''}
                        </p>
                        {imageIpfsUri ? (
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <Check size={14} weight="bold" className="text-green-600" />
                            <span className="text-green-700 font-medium">Pinned to IPFS</span>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-500 mt-2">
                            Will be uploaded to IPFS when you create the token
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={removeImage}
                        data-testid="remove-image-btn"
                        className="p-2 hover:bg-zinc-200 transition-colors"
                      >
                        <Trash size={18} weight="bold" className="text-zinc-600" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    data-testid="image-dropzone"
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={`border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200 ${
                      dragActive
                        ? 'border-black bg-zinc-100'
                        : 'border-zinc-300 hover:border-zinc-500 hover:bg-zinc-50'
                    }`}
                  >
                    <UploadSimple size={36} weight="bold" className="mx-auto text-zinc-400 mb-3" />
                    <p className="text-sm font-semibold text-zinc-700">
                      Drop image here or click to browse
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      PNG, JPEG, GIF, WEBP, SVG — Max 5MB
                    </p>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="image-file-input"
                />

                {/* Fallback: URL input */}
                {!imageFile && (
                  <div className="mt-3">
                    <p className="text-xs text-zinc-400 mb-1">Or paste an image URL:</p>
                    <Input
                      data-testid="token-image-url-input"
                      value={formData.image}
                      onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                      onBlur={() => handleBlur('image')}
                      placeholder="https://example.com/image.png"
                      type="url"
                      className={inputClass('image', 'text-sm')}
                    />
                    {showError('image') && (
                      <p data-testid="error-image" className="text-xs text-red-600 mt-1.5">{fieldErrors.image}</p>
                    )}
                  </div>
                )}
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
                    onBlur={() => handleBlur('twitter')}
                    placeholder="@mytoken"
                    className={inputClass('twitter')}
                  />
                  {showError('twitter') && (
                    <p data-testid="error-twitter" className="text-xs text-red-600 mt-1.5">{fieldErrors.twitter}</p>
                  )}
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
                    onBlur={() => handleBlur('telegram')}
                    placeholder="t.me/mytoken"
                    className={inputClass('telegram')}
                  />
                  {showError('telegram') && (
                    <p data-testid="error-telegram" className="text-xs text-red-600 mt-1.5">{fieldErrors.telegram}</p>
                  )}
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
                    onBlur={() => handleBlur('website')}
                    placeholder="https://mytoken.com"
                    type="url"
                    className={inputClass('website')}
                  />
                  {showError('website') && (
                    <p data-testid="error-website" className="text-xs text-red-600 mt-1.5">{fieldErrors.website}</p>
                  )}
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
              disabled={!connected || loading || uploading}
              className="w-full mt-8 bg-black text-white hover:bg-zinc-800 rounded-none h-12 font-bold tracking-wide transition-all duration-200 hover:shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] hover:-translate-y-1"
            >
              {uploading ? 'Uploading image...' : loading ? 'Creating...' : connected ? 'Create Token' : 'Connect Wallet'}
            </Button>

            <div className="mt-4">
              <CostPreviewChip valid={Object.keys(fieldErrors).filter((k) => fieldErrors[k]).length === 0 && !!formData.name && !!formData.symbol && !!formData.totalSupply} />
            </div>

            {!connected && (
              <div className="mt-6 border border-zinc-300 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Warning size={18} weight="bold" className="text-zinc-500" />
                  <p className="text-sm font-semibold text-zinc-700">Wallet Required</p>
                </div>
                <p className="text-xs text-zinc-500 mb-3">Connect your Phantom or Solflare wallet to create tokens on mainnet.</p>
                <WalletMultiButton data-testid="connect-wallet-sidebar" />
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Success Modal */}
      <SuccessModal data={successData} onClose={() => setSuccessData(null)} />

      {/* Safety Confirmation Modal — required user click before signing */}
      <SafetyConfirmModal
        open={!!safetyModal?.open}
        loadingSimulation={!!safetyModal?.loadingSimulation}
        simulation={safetyModal?.simulation}
        actionLabel="Create SPL Token"
        walletAddress={publicKey?.toBase58() || ''}
        breakdownLines={[
          { label: 'Token name', value: formData.name || '—' },
          { label: 'Symbol', value: formData.symbol || '—' },
          { label: 'Total supply', value: formData.totalSupply ? Number(formData.totalSupply).toLocaleString() : '—' },
          { label: 'Decimals', value: String(formData.decimals) },
        ]}
        primaryActionText="Confirm & Sign in wallet"
        onCancel={() => {
          safetyModal?.resolve?.(false);
          setSafetyModal(null);
        }}
        onConfirm={() => {
          safetyModal?.resolve?.(true);
          setSafetyModal(null);
        }}
      />
    </div>
  );
};

export default TokenCreationForm;
