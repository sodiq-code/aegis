package extension

import (
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"extension-scaffold/internal/onchain"
)

// coston2FTSOProvider implements risk.FTSOProvider against the real Coston2
// network.
//
// The voting round is read live from FlareSystemsManager.getCurrentVotingEpochId
// so that the solvency proof published by the TEE carries the canonical round
// ID that auditors use to verify FDC attestations. (The MockFTSOProvider
// returned round=1, which is not a real Flare voting round and would make the
// on-chain proof meaningless for FDC cross-checks.)
//
// Price feeds currently return conservative fallback values; prices only
// influence the risk-score → action mapping (hold / hedge / rebalance), never
// the correctness of the published solvency proof (whose Merkle root,
// collateral, liabilities, and voting round are all sourced on-chain).
type coston2FTSOProvider struct {
	client   *ethclient.Client
	fsmABI   abi.ABI
	fsmAddr  common.Address
	defaults map[string]float64
}

// newCoston2FTSOProvider dials the Coston2 RPC and prepares the
// FlareSystemsManager binding used to read the real voting round.
func newCoston2FTSOProvider(rpcURL string) (*coston2FTSOProvider, error) {
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, fmt.Errorf("dial RPC: %w", err)
	}

	parsedABI, err := abi.JSON(strings.NewReader(onchain.FlareSystemsManagerABI))
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("parse FlareSystemsManager ABI: %w", err)
	}

	return &coston2FTSOProvider{
		client:  client,
		fsmABI:  parsedABI,
		fsmAddr: common.HexToAddress(onchain.FlareSystemsManagerAddress),
		defaults: map[string]float64{
			"XRP/USD": 1.08,
			"FLR/USD": 0.006,
			"BTC/USD": 63114.0,
			"ETH/USD": 1868.0,
		},
	}, nil
}

// GetLatestRound reads the real current voting epoch ID from
// FlareSystemsManager on Coston2. This is the canonical round ID.
func (p *coston2FTSOProvider) GetLatestRound() (uint64, error) {
	if p.client == nil {
		return 0, fmt.Errorf("not connected to RPC")
	}
	contract := bind.NewBoundContract(p.fsmAddr, p.fsmABI, p.client, p.client, p.client)
	var results []interface{}
	if err := contract.Call(&bind.CallOpts{}, &results, "getCurrentVotingEpochId"); err != nil {
		return 0, fmt.Errorf("getCurrentVotingEpochId: %w", err)
	}
	if len(results) < 1 {
		return 0, fmt.Errorf("empty result from getCurrentVotingEpochId")
	}
	roundBig, ok := results[0].(*big.Int)
	if !ok {
		return 0, fmt.Errorf("unexpected result type: %T", results[0])
	}
	return roundBig.Uint64(), nil
}

// GetPrice returns the price for a feed ID. Real FTSO V2 price reads require
// feed-index encoding lookup; conservative defaults are used so the risk
// scorer always has a usable input. Prices do not affect proof correctness.
func (p *coston2FTSOProvider) GetPrice(feedID string) (float64, error) {
	if v, ok := p.defaults[feedID]; ok {
		return v, nil
	}
	return 0, fmt.Errorf("feed not found: %s", feedID)
}

// Close releases the RPC connection.
func (p *coston2FTSOProvider) Close() {
	if p.client != nil {
		p.client.Close()
	}
}
