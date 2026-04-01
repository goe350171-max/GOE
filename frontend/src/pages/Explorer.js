import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MagnifyingGlass, Check, X, ArrowSquareOut } from '@phosphor-icons/react';
import { Input } from '../components/ui/input';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const TokenExplorer = () => {
  const [tokens, setTokens] = useState([]);
  const [filteredTokens, setFilteredTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchTokens();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      const filtered = tokens.filter(
        (token) =>
          token.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          token.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          token.mint.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredTokens(filtered);
    } else {
      setFilteredTokens(tokens);
    }
  }, [searchQuery, tokens]);

  const fetchTokens = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/tokens`);
      setTokens(response.data);
      setFilteredTokens(response.data);
    } catch (error) {
      console.error('Error fetching tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const truncateAddress = (address) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const openInExplorer = (mint) => {
    window.open(`https://explorer.solana.com/address/${mint}`, '_blank');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tighter mb-4">
          Token Explorer
        </h1>
        <p className="text-lg text-zinc-700 mb-6">
          Browse all tokens created on the launchpad
        </p>

        <div className="relative max-w-md">
          <MagnifyingGlass
            size={20}
            className="absolute left-4 top-1/2 transform -translate-y-1/2 text-zinc-400"
            weight="bold"
          />
          <Input
            data-testid="search-tokens-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tokens..."
            className="pl-12 rounded-none border-zinc-300 focus:border-black focus:ring-1 focus:ring-black"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-zinc-300 border-t-black mx-auto mb-4" />
            <p className="text-zinc-600">Loading tokens...</p>
          </div>
        </div>
      ) : filteredTokens.length === 0 ? (
        <div className="bg-white border border-zinc-300 p-12 text-center">
          <p className="text-zinc-600">
            {searchQuery ? 'No tokens found matching your search' : 'No tokens created yet'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-300 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="token-explorer-table">
              <thead>
                <tr className="border-b border-zinc-300 bg-zinc-50">
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-zinc-700">
                    Token
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-zinc-700">
                    Mint Address
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-zinc-700">
                    Supply
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-zinc-700">
                    Mint Authority
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-zinc-700">
                    Freeze Authority
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold uppercase tracking-wider text-zinc-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTokens.map((token, index) => (
                  <tr
                    key={token.id}
                    data-testid={`token-row-${index}`}
                    className="border-b border-zinc-200 hover:bg-zinc-50 transition-colors duration-200"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {token.logo ? (
                          <img
                            src={token.logo}
                            alt={token.name}
                            className="w-10 h-10 border border-zinc-300 object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 bg-zinc-200 border border-zinc-300 flex items-center justify-center">
                            <span className="text-xs font-bold text-zinc-500">
                              {token.symbol.slice(0, 2)}
                            </span>
                          </div>
                        )}
                        <div>
                          <div className="font-semibold text-sm">{token.name}</div>
                          <div className="text-xs text-zinc-500">{token.symbol}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-xs font-mono bg-zinc-100 px-2 py-1 border border-zinc-200">
                        {truncateAddress(token.mint)}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">
                      {formatNumber(token.total_supply)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {token.mint_authority_revoked ? (
                        <div className="inline-flex items-center gap-1 text-success">
                          <X size={16} weight="bold" />
                          <span className="text-xs font-medium">Revoked</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 text-zinc-500">
                          <Check size={16} weight="bold" />
                          <span className="text-xs font-medium">Active</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {token.freeze_authority_revoked ? (
                        <div className="inline-flex items-center gap-1 text-success">
                          <X size={16} weight="bold" />
                          <span className="text-xs font-medium">Revoked</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 text-zinc-500">
                          <Check size={16} weight="bold" />
                          <span className="text-xs font-medium">Active</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => openInExplorer(token.mint)}
                        data-testid={`view-explorer-${index}`}
                        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-zinc-300 hover:bg-black hover:text-white hover:border-black transition-all duration-200"
                      >
                        <span>View</span>
                        <ArrowSquareOut size={14} weight="bold" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && filteredTokens.length > 0 && (
        <div className="mt-6 text-center text-sm text-zinc-600">
          Showing {filteredTokens.length} of {tokens.length} tokens
        </div>
      )}
    </div>
  );
};

export default TokenExplorer;
