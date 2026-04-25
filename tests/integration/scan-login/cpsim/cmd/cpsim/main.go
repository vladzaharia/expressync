// cpsim — minimal OCPP 1.6J chargepoint simulator driven by line-delimited
// JSON-RPC over stdin/stdout. Intentionally low-level (one process, no
// SDK harness around it) so the Deno test layer can drive it from any
// language.
//
// Protocol:
//
//	request:  {"id":<int>, "method":"<name>", "params":{...}}\n
//	response: {"id":<int>, "result":{...}} or {"id":<int>, "error":"..."}
//
// Server-initiated calls (RemoteStart, RemoteStop, ChangeAvailability)
// land in an in-memory event log; query with `events` (since=<int>).
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	ocpp16 "github.com/lorenzodonini/ocpp-go/ocpp1.6"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/core"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/firmware"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/localauth"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/remotetrigger"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/reservation"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/smartcharging"
	"github.com/lorenzodonini/ocpp-go/ocpp1.6/types"
)

type rpcRequest struct {
	ID     int             `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type rpcResponse struct {
	ID     int         `json:"id"`
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type serverEvent struct {
	Seq     int                    `json:"seq"`
	T       int64                  `json:"t"`
	Kind    string                 `json:"kind"`
	Payload map[string]interface{} `json:"payload"`
}

// --- handler that captures CSMS-initiated calls -----------------------------

type handler struct {
	mu       sync.Mutex
	events   []serverEvent
	seq      int
	chargeID string
}

func (h *handler) record(kind string, payload map[string]interface{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seq++
	h.events = append(h.events, serverEvent{
		Seq:     h.seq,
		T:       time.Now().UnixMilli(),
		Kind:    kind,
		Payload: payload,
	})
}

// core.ChargePointHandler
func (h *handler) OnChangeAvailability(req *core.ChangeAvailabilityRequest) (*core.ChangeAvailabilityConfirmation, error) {
	h.record("ChangeAvailability", map[string]interface{}{
		"connectorId": req.ConnectorId,
		"type":        string(req.Type),
	})
	return core.NewChangeAvailabilityConfirmation(core.AvailabilityStatusAccepted), nil
}

func (h *handler) OnChangeConfiguration(req *core.ChangeConfigurationRequest) (*core.ChangeConfigurationConfirmation, error) {
	h.record("ChangeConfiguration", map[string]interface{}{"key": req.Key, "value": req.Value})
	return core.NewChangeConfigurationConfirmation(core.ConfigurationStatusAccepted), nil
}

func (h *handler) OnClearCache(*core.ClearCacheRequest) (*core.ClearCacheConfirmation, error) {
	h.record("ClearCache", map[string]interface{}{})
	return core.NewClearCacheConfirmation(core.ClearCacheStatusAccepted), nil
}

func (h *handler) OnDataTransfer(req *core.DataTransferRequest) (*core.DataTransferConfirmation, error) {
	h.record("DataTransfer", map[string]interface{}{"vendorId": req.VendorId})
	return core.NewDataTransferConfirmation(core.DataTransferStatusAccepted), nil
}

func (h *handler) OnGetConfiguration(req *core.GetConfigurationRequest) (*core.GetConfigurationConfirmation, error) {
	h.record("GetConfiguration", map[string]interface{}{"key": req.Key})
	return &core.GetConfigurationConfirmation{}, nil
}

func (h *handler) OnRemoteStartTransaction(req *core.RemoteStartTransactionRequest) (*core.RemoteStartTransactionConfirmation, error) {
	connID := 0
	if req.ConnectorId != nil {
		connID = *req.ConnectorId
	}
	h.record("RemoteStartTransaction", map[string]interface{}{
		"idTag":       req.IdTag,
		"connectorId": connID,
	})
	return core.NewRemoteStartTransactionConfirmation(types.RemoteStartStopStatusAccepted), nil
}

func (h *handler) OnRemoteStopTransaction(req *core.RemoteStopTransactionRequest) (*core.RemoteStopTransactionConfirmation, error) {
	h.record("RemoteStopTransaction", map[string]interface{}{"transactionId": req.TransactionId})
	return core.NewRemoteStopTransactionConfirmation(types.RemoteStartStopStatusAccepted), nil
}

func (h *handler) OnReset(req *core.ResetRequest) (*core.ResetConfirmation, error) {
	h.record("Reset", map[string]interface{}{"type": string(req.Type)})
	return core.NewResetConfirmation(core.ResetStatusAccepted), nil
}

func (h *handler) OnUnlockConnector(req *core.UnlockConnectorRequest) (*core.UnlockConnectorConfirmation, error) {
	h.record("UnlockConnector", map[string]interface{}{"connectorId": req.ConnectorId})
	return core.NewUnlockConnectorConfirmation(core.UnlockStatusUnlocked), nil
}

// firmware.ChargePointHandler
func (h *handler) OnGetDiagnostics(req *firmware.GetDiagnosticsRequest) (*firmware.GetDiagnosticsConfirmation, error) {
	h.record("GetDiagnostics", map[string]interface{}{"location": req.Location})
	return &firmware.GetDiagnosticsConfirmation{}, nil
}

func (h *handler) OnUpdateFirmware(req *firmware.UpdateFirmwareRequest) (*firmware.UpdateFirmwareConfirmation, error) {
	h.record("UpdateFirmware", map[string]interface{}{"location": req.Location})
	return firmware.NewUpdateFirmwareConfirmation(), nil
}

// localauth.ChargePointHandler
func (h *handler) OnGetLocalListVersion(*localauth.GetLocalListVersionRequest) (*localauth.GetLocalListVersionConfirmation, error) {
	h.record("GetLocalListVersion", map[string]interface{}{})
	return localauth.NewGetLocalListVersionConfirmation(0), nil
}

func (h *handler) OnSendLocalList(req *localauth.SendLocalListRequest) (*localauth.SendLocalListConfirmation, error) {
	h.record("SendLocalList", map[string]interface{}{"version": req.ListVersion})
	return localauth.NewSendLocalListConfirmation(localauth.UpdateStatusAccepted), nil
}

// remotetrigger.ChargePointHandler
func (h *handler) OnTriggerMessage(req *remotetrigger.TriggerMessageRequest) (*remotetrigger.TriggerMessageConfirmation, error) {
	h.record("TriggerMessage", map[string]interface{}{"requestedMessage": string(req.RequestedMessage)})
	return remotetrigger.NewTriggerMessageConfirmation(remotetrigger.TriggerMessageStatusAccepted), nil
}

// reservation.ChargePointHandler
func (h *handler) OnReserveNow(req *reservation.ReserveNowRequest) (*reservation.ReserveNowConfirmation, error) {
	h.record("ReserveNow", map[string]interface{}{"reservationId": req.ReservationId})
	return reservation.NewReserveNowConfirmation(reservation.ReservationStatusAccepted), nil
}

func (h *handler) OnCancelReservation(req *reservation.CancelReservationRequest) (*reservation.CancelReservationConfirmation, error) {
	h.record("CancelReservation", map[string]interface{}{"reservationId": req.ReservationId})
	return reservation.NewCancelReservationConfirmation(reservation.CancelReservationStatusAccepted), nil
}

// smartcharging.ChargePointHandler
func (h *handler) OnSetChargingProfile(req *smartcharging.SetChargingProfileRequest) (*smartcharging.SetChargingProfileConfirmation, error) {
	h.record("SetChargingProfile", map[string]interface{}{"connectorId": req.ConnectorId})
	return smartcharging.NewSetChargingProfileConfirmation(smartcharging.ChargingProfileStatusAccepted), nil
}

func (h *handler) OnClearChargingProfile(*smartcharging.ClearChargingProfileRequest) (*smartcharging.ClearChargingProfileConfirmation, error) {
	h.record("ClearChargingProfile", map[string]interface{}{})
	return smartcharging.NewClearChargingProfileConfirmation(smartcharging.ClearChargingProfileStatusAccepted), nil
}

func (h *handler) OnGetCompositeSchedule(req *smartcharging.GetCompositeScheduleRequest) (*smartcharging.GetCompositeScheduleConfirmation, error) {
	h.record("GetCompositeSchedule", map[string]interface{}{"connectorId": req.ConnectorId})
	return smartcharging.NewGetCompositeScheduleConfirmation(smartcharging.GetCompositeScheduleStatusAccepted), nil
}

// --- driver -----------------------------------------------------------------

type driver struct {
	mu                  sync.Mutex
	cp                  ocpp16.ChargePoint
	h                   *handler
	lastAuthorizeStatus string
}

func writeResp(w *bufio.Writer, r rpcResponse) {
	b, _ := json.Marshal(r)
	w.Write(b)
	w.WriteByte('\n')
	w.Flush()
}

func (d *driver) handle(req rpcRequest) rpcResponse {
	d.mu.Lock()
	defer d.mu.Unlock()
	resp := rpcResponse{ID: req.ID}
	switch req.Method {
	case "connect":
		var p struct {
			URL          string `json:"url"`
			ChargeBoxID  string `json:"chargeBoxId"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			resp.Error = err.Error()
			return resp
		}
		d.h = &handler{chargeID: p.ChargeBoxID}
		d.cp = ocpp16.NewChargePoint(p.ChargeBoxID, nil, nil)
		d.cp.SetCoreHandler(d.h)
		d.cp.SetFirmwareManagementHandler(d.h)
		d.cp.SetLocalAuthListHandler(d.h)
		d.cp.SetRemoteTriggerHandler(d.h)
		d.cp.SetReservationHandler(d.h)
		d.cp.SetSmartChargingHandler(d.h)
		if err := d.cp.Start(p.URL); err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = map[string]interface{}{"connected": true}
	case "bootNotification":
		var p struct {
			Model  string `json:"model"`
			Vendor string `json:"vendor"`
		}
		_ = json.Unmarshal(req.Params, &p)
		if p.Model == "" {
			p.Model = "cpsim"
		}
		if p.Vendor == "" {
			p.Vendor = "ExpresSyncTest"
		}
		conf, err := d.cp.BootNotification(p.Model, p.Vendor)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = map[string]interface{}{
			"status":      string(conf.Status),
			"interval":    conf.Interval,
			"currentTime": conf.CurrentTime.String(),
		}
	case "statusNotification":
		var p struct {
			ConnectorID int    `json:"connectorId"`
			Status      string `json:"status"`
			ErrorCode   string `json:"errorCode"`
		}
		_ = json.Unmarshal(req.Params, &p)
		if p.Status == "" {
			p.Status = string(core.ChargePointStatusAvailable)
		}
		if p.ErrorCode == "" {
			p.ErrorCode = string(core.NoError)
		}
		_, err := d.cp.StatusNotification(p.ConnectorID, core.ChargePointErrorCode(p.ErrorCode), core.ChargePointStatus(p.Status))
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = map[string]interface{}{"ok": true}
	case "authorize":
		var p struct {
			IDTag string `json:"idTag"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			resp.Error = err.Error()
			return resp
		}
		conf, err := d.cp.Authorize(p.IDTag)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		d.lastAuthorizeStatus = string(conf.IdTagInfo.Status)
		resp.Result = map[string]interface{}{
			"status":       string(conf.IdTagInfo.Status),
			"expiryDate":   conf.IdTagInfo.ExpiryDate,
			"parentIdTag":  conf.IdTagInfo.ParentIdTag,
		}
	case "lastAuthorizeStatus":
		resp.Result = map[string]interface{}{"status": d.lastAuthorizeStatus}
	case "startTransaction":
		var p struct {
			ConnectorID int    `json:"connectorId"`
			IDTag       string `json:"idTag"`
			MeterStart  int    `json:"meterStart"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			resp.Error = err.Error()
			return resp
		}
		conf, err := d.cp.StartTransaction(p.ConnectorID, p.IDTag, p.MeterStart, types.NewDateTime(time.Now()))
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = map[string]interface{}{
			"transactionId": conf.TransactionId,
			"idTagInfo": map[string]interface{}{
				"status": string(conf.IdTagInfo.Status),
			},
		}
	case "stopTransaction":
		var p struct {
			TransactionID int `json:"transactionId"`
			MeterStop     int `json:"meterStop"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil {
			resp.Error = err.Error()
			return resp
		}
		conf, err := d.cp.StopTransaction(p.MeterStop, types.NewDateTime(time.Now()), p.TransactionID)
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		status := ""
		if conf.IdTagInfo != nil {
			status = string(conf.IdTagInfo.Status)
		}
		resp.Result = map[string]interface{}{"idTagStatus": status}
	case "heartbeat":
		conf, err := d.cp.Heartbeat()
		if err != nil {
			resp.Error = err.Error()
			return resp
		}
		resp.Result = map[string]interface{}{"currentTime": conf.CurrentTime.String()}
	case "events":
		var p struct {
			Since int `json:"since"`
		}
		_ = json.Unmarshal(req.Params, &p)
		if d.h == nil {
			resp.Result = []serverEvent{}
			return resp
		}
		d.h.mu.Lock()
		out := make([]serverEvent, 0, len(d.h.events))
		for _, e := range d.h.events {
			if e.Seq > p.Since {
				out = append(out, e)
			}
		}
		d.h.mu.Unlock()
		resp.Result = out
	case "disconnect":
		if d.cp != nil {
			d.cp.Stop()
		}
		resp.Result = map[string]interface{}{"ok": true}
	default:
		resp.Error = fmt.Sprintf("unknown method: %s", req.Method)
	}
	return resp
}

func main() {
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	d := &driver{}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	w := bufio.NewWriter(os.Stdout)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req rpcRequest
		if err := json.Unmarshal(line, &req); err != nil {
			writeResp(w, rpcResponse{ID: 0, Error: "parse: " + err.Error()})
			continue
		}
		resp := d.handle(req)
		writeResp(w, resp)
	}
	if d.cp != nil {
		d.cp.Stop()
	}
}
