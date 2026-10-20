package com.castboxtv.app.dlna

import android.util.Log
import org.fourthline.cling.support.connectionmanager.ConnectionManagerService
import org.fourthline.cling.support.model.Protocol
import org.fourthline.cling.support.model.ProtocolInfo
import org.fourthline.cling.support.model.ProtocolInfos

class DlnaConnectionManagerService : ConnectionManagerService(
    ProtocolInfos(
        ProtocolInfo(Protocol.HTTP_GET, "*", "audio/mpeg", "*"),
        ProtocolInfo(Protocol.HTTP_GET, "*", "audio/mp3", "*"),
        ProtocolInfo(Protocol.HTTP_GET, "*", "audio/x-wav", "*"),
        ProtocolInfo(Protocol.HTTP_GET, "*", "audio/ogg", "*"),
        ProtocolInfo(Protocol.HTTP_GET, "*", "audio/aac", "*"),
        ProtocolInfo(Protocol.HTTP_GET, "*", "audio/flac", "*")
    ),
    ProtocolInfos()
) {
    init {
        Log.d("DLNA", "DlnaConnectionManagerService created, sourceProtocolInfo=${sourceProtocolInfo}")
    }

    override fun getCurrentConnectionInfo(connectionId: Int): org.fourthline.cling.support.model.ConnectionInfo {
        Log.d("DLNA", "getCurrentConnectionInfo id=$connectionId")
        throw org.fourthline.cling.model.action.ActionException(
            org.fourthline.cling.model.types.ErrorCode.ACTION_FAILED,
            "No active connections"
        )
    }
}
